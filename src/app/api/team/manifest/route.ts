import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { agents } from '@/db/schema'
import { requireRole } from '@/lib/auth'

// ---------------------------------------------------------------------------
// SOUL.md frontmatter parser
// ---------------------------------------------------------------------------

interface SoulFrontmatter {
  name?: string
  emoji?: string
  goal?: string
  reports_to?: string
}

function parseSoulFrontmatter(soul: string | null): SoulFrontmatter {
  if (!soul) return {}
  const match = soul.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}

  const fm: SoulFrontmatter = {}
  for (const line of match[1].split('\n')) {
    const sep = line.indexOf(':')
    if (sep === -1) continue
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    if (key === 'name') fm.name = value
    else if (key === 'emoji') fm.emoji = value
    else if (key === 'goal') fm.goal = value
    else if (key === 'reports_to') fm.reports_to = value
  }
  return fm
}

// ---------------------------------------------------------------------------
// GET /api/team/manifest
// Builds the team manifest from Neon DB — no local filesystem dependency.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const rows = await db.select({
      id: agents.id,
      name: agents.name,
      role: agents.role,
      soul_content: agents.soul_content,
      status: agents.status,
      last_seen: agents.last_seen,
      last_activity: agents.last_activity,
      config: agents.config,
      workspace_path: agents.workspace_path,
    }).from(agents)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No agents found in database' }, { status: 404 })
    }

    // Build a lookup: agentId → parsed data
    interface ParsedAgent {
      id: string           // openclaw id (e.g. "cody")
      workspace: string
      name: string         // display name
      emoji: string
      goal: string
      reports_to: string
      model: string | { primary: string; fallbacks?: string[] }
      skills: string[]
      tools: Record<string, any>
      heartbeat: Record<string, any>
      subagents: { allowAgents?: string[] }
      duties: string[]
      policies: string[]
      channels: { channel: string; purpose: string }[]
      references: string[]
      crons: { id: string; name: string; schedule: any; enabled: boolean }[]
      soul_md: string | null
      status: string
      last_seen: number | null
      last_activity: string | null
    }

    const parsed: ParsedAgent[] = rows.map((row) => {
      const cfg = (() => {
        try { return row.config ? JSON.parse(row.config) : {} }
        catch { return {} }
      })()

      const fm = parseSoulFrontmatter(row.soul_content)

      const openclaw_id: string = cfg.openclawId || row.name.toLowerCase().replace(/\s+/g, '-')
      const workspace: string = cfg.workspace || row.workspace_path || ''
      const display_name: string = fm.name || cfg.identity?.name || row.name
      const emoji: string = fm.emoji || cfg.identity?.emoji || ''
      const goal: string = fm.goal || ''
      const reports_to: string = fm.reports_to || ''

      const model: string | { primary: string; fallbacks?: string[] } = cfg.model || 'unknown'

      // Skills: top-level skills[] in openclaw.json stored in config
      const skills: string[] = Array.isArray(cfg.skills) ? cfg.skills : []

      const tools: Record<string, any> = cfg.tools || {}
      const heartbeat: Record<string, any> = cfg.heartbeat || {}

      const subagents: { allowAgents?: string[] } = {
        allowAgents: cfg.subagents?.allowAgents || cfg.subagents?.allow || [],
      }

      // duties, policies, channels, crons — not synced to DB yet;
      // kept as empty arrays for Vercel. Local manifest can still supply them
      // if we add those fields to agent-sync later.
      const duties: string[] = []
      const policies: string[] = []
      const channels: { channel: string; purpose: string }[] = []
      const crons: { id: string; name: string; schedule: any; enabled: boolean }[] = []

      return {
        id: openclaw_id,
        workspace,
        name: display_name,
        emoji,
        goal,
        reports_to,
        model,
        skills,
        tools,
        heartbeat,
        subagents,
        duties,
        policies,
        channels,
        references: [],
        crons,
        soul_md: row.soul_content || null,
        status: row.status || 'offline',
        last_seen: row.last_seen,
        last_activity: row.last_activity,
      }
    })

    // ---------------------------------------------------------------------------
    // Build relationships from reports_to
    // ---------------------------------------------------------------------------

    const agentIds = new Set(parsed.map((a) => a.id))

    const hierarchyRelationships: { from: string; to: string; label: string }[] = []
    for (const a of parsed) {
      if (a.reports_to) {
        hierarchyRelationships.push({ from: a.id, to: a.reports_to, label: 'reports to' })
      }
    }

    // hierarchy map: parent → children[]
    const hierarchyMap: Record<string, string[]> = {}
    for (const rel of hierarchyRelationships) {
      const parent = rel.to
      if (!hierarchyMap[parent]) hierarchyMap[parent] = []
      hierarchyMap[parent].push(rel.from)
    }

    // ---------------------------------------------------------------------------
    // Build manifest agents list
    // ---------------------------------------------------------------------------

    const manifestAgents = parsed.map((a) => ({
      id: a.id,
      workspace: a.workspace,
      config: {
        model: a.model,
        skills: a.skills,
        tools: a.tools,
        heartbeat: a.heartbeat,
        subagents: a.subagents,
      },
      identity: {
        name: a.name,
        emoji: a.emoji,
        goal: a.goal,
        reports_to: a.reports_to,
        sub_agents: agentIds.has(a.id)
          ? parsed.filter((x) => x.reports_to === a.id).map((x) => x.id)
          : [],
      },
      docs: { version: 1, updated: '' },
      duties: a.duties,
      policies: a.policies,
      channels: a.channels,
      references: a.references,
      crons: a.crons,
      soul_md: a.soul_md,
      agents_md: null as string | null,
      live: {
        status: a.status,
        last_seen: a.last_seen,
        last_activity: a.last_activity,
      },
    }))

    return NextResponse.json({
      _meta: {
        generated_at: new Date().toISOString(),
        generator: 'neon-db',
        version: 2,
      },
      hierarchy: hierarchyMap,
      agent_to_agent: { allow: parsed.map((a) => a.id) },
      relationships: {
        hierarchy: hierarchyRelationships,
        comms: [],
      },
      agents: manifestAgents,
    })
  } catch (err: any) {
    console.error('[team/manifest] Error:', err)
    return NextResponse.json({ error: 'Failed to build team manifest', details: err.message }, { status: 500 })
  }
}
