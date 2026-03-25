import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { agents } from '@/db/schema'
import { requireRole } from '@/lib/auth'
import fs from 'fs'
import path from 'path'
import os from 'os'

const MANIFEST_PATH = path.join(
  os.homedir(),
  '.openclaw/workspaces/main/data/team-manifest.json'
)

const RELATIONSHIPS_PATH = path.join(
  os.homedir(),
  '.openclaw/workspaces/main/data/team-relationships.json'
)

interface ManifestAgent {
  id: string
  workspace: string
  config: {
    model: string | { primary: string; fallbacks?: string[] }
    skills: string[]
    tools: Record<string, any>
    heartbeat: Record<string, any>
    subagents: { allowAgents?: string[] }
  }
  identity: {
    name: string
    emoji: string
    goal: string
    reports_to: string
    sub_agents: string[]
  }
  docs: { version: number; updated: string }
  duties: string[]
  policies: string[]
  channels: { channel: string; purpose: string }[]
  references: string[]
  crons?: { id: string; name: string; schedule: any; enabled: boolean }[]
  discord?: { bot_name: string; account_key: string }
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    if (!fs.existsSync(MANIFEST_PATH)) {
      return NextResponse.json({ error: 'team-manifest.json not found' }, { status: 404 })
    }

    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8')
    const manifest = JSON.parse(raw)

    const liveAgents = await db.select({
      id: agents.id,
      name: agents.name,
      status: agents.status,
      last_seen: agents.last_seen,
      last_activity: agents.last_activity,
      config: agents.config,
    }).from(agents)

    const liveMap = new Map<string, typeof liveAgents[0]>()
    for (const a of liveAgents) {
      liveMap.set(a.name.toLowerCase(), a)
    }

    const agentList = (manifest.agents as ManifestAgent[]).map((agent) => {
      const live = liveMap.get(agent.identity.name.toLowerCase()) || liveMap.get(agent.id.toLowerCase())
      return {
        ...agent,
        live: live
          ? { status: live.status || 'offline', last_seen: live.last_seen, last_activity: live.last_activity }
          : { status: 'offline' as const, last_seen: null, last_activity: null },
      }
    })

    let relationships = { hierarchy: [], comms: [] }
    try {
      if (fs.existsSync(RELATIONSHIPS_PATH)) {
        relationships = JSON.parse(fs.readFileSync(RELATIONSHIPS_PATH, 'utf-8'))
      }
    } catch {}

    return NextResponse.json({
      _meta: manifest._meta,
      hierarchy: manifest.hierarchy || {},
      agent_to_agent: manifest.agent_to_agent || {},
      relationships,
      agents: agentList,
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to load team manifest', details: err.message }, { status: 500 })
  }
}
