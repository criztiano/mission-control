import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { issues } from '@/db/schema'
import { getProject, mapIssueToTask } from '@/lib/cc-db'
import type { IssueStatus } from '@/lib/cc-db'
import { logger } from '@/lib/logger'
import { randomUUID } from 'crypto'

/**
 * POST /api/tasks/create-from-prompt
 *
 * Parse a natural-language prompt into a task using simple rules.
 * Supports:
 *   @agent     — assign to agent
 *   /project   — assign to project by name
 *
 * LLM-based parsing (spec §3) is a future enhancement.
 * For now: rule-based extraction, clean title derivation.
 */

interface RequestBody {
  prompt: string
  active_project_filter?: string | null
  projects?: Array<{ id: string; title?: string; name?: string; description?: string }>
  agents?: Array<{ id: string; name: string; role?: string }>
}

function deriveTitle(text: string): string {
  // Remove @mentions and /project from text
  const clean = text
    .replace(/@[\w-]+/g, '')
    .replace(/\/[\w-]+/g, '')
    .trim()
    .replace(/\s+/g, ' ')

  const firstLine = clean.split('\n')[0].trim()
  // Capitalise first letter, strip trailing punctuation
  const titled = firstLine.charAt(0).toUpperCase() + firstLine.slice(1)
  return titled.replace(/[.!?]+$/, '').slice(0, 80)
}

function parseAgentMention(prompt: string, agents: RequestBody['agents']): string {
  const match = prompt.match(/@([\w-]+)/i)
  if (!match) return 'cri'
  const mention = match[1].toLowerCase()
  if (!agents) return mention
  const found = agents.find((a) => a.name.toLowerCase() === mention)
  return found ? found.name : mention
}

function parseProjectSlash(
  prompt: string,
  projects: RequestBody['projects'],
  activeProjectFilter: string | null | undefined,
): string | null {
  const match = prompt.match(/\/([\w-]+)/i)
  if (match) {
    const slug = match[1].toLowerCase()
    if (slug === 'new') return null // special — future: create new project
    const found = projects?.find(
      (p) => (p.title || p.name || '').toLowerCase() === slug || p.id.toLowerCase() === slug,
    )
    if (found) return found.id
  }
  // Fall back to active filter if set
  if (activeProjectFilter) return activeProjectFilter
  return null
}

function derivePriority(prompt: string): 'low' | 'normal' | 'high' {
  const lower = prompt.toLowerCase()
  if (/\b(urgent|asap|blocking|broken in prod|critical)\b/.test(lower)) return 'high'
  if (/\b(high|important|priority)\b/.test(lower)) return 'high'
  return 'normal'
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body: RequestBody = await request.json()
    const { prompt, active_project_filter, projects = [], agents = [] } = body

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }

    const title = deriveTitle(prompt)
    if (!title) {
      return NextResponse.json({ error: 'Could not derive title from prompt' }, { status: 400 })
    }

    const assignee = parseAgentMention(prompt, agents)
    const project_id = parseProjectSlash(prompt, projects, active_project_filter)
    const priority = derivePriority(prompt)
    const now = new Date().toISOString()
    const id = randomUUID()
    const creator = (auth as any).user?.username || 'cri'

    await db.insert(issues).values({
      id,
      title,
      description: prompt.trim(),
      status: 'open' as IssueStatus,
      assignee,
      creator,
      priority,
      project_id: project_id || null,
      created_at: now,
      updated_at: now,
      archived: false,
      blocked_by: '[]',
      schedule: '',
    })

    const projectTitle = project_id ? (await getProject(project_id))?.title : undefined

    const task = mapIssueToTask({
      id,
      title,
      description: prompt.trim(),
      status: 'open' as IssueStatus,
      assignee,
      creator,
      priority,
      project_id: project_id || null,
      created_at: now,
      updated_at: now,
      archived: false,
      blocked_by: '[]',
      schedule: '',
      parent_id: null,
      notion_id: '',
      plan_path: null,
      plan_id: null,
      last_turn_at: null,
      seen_at: null,
      picked: false,
      picked_at: null,
      picked_by: '',
      last_comment_at: null,
    }, projectTitle)

    return NextResponse.json({ task })
  } catch (err: any) {
    logger.error({ err }, 'POST /api/tasks/create-from-prompt error')
    return NextResponse.json({ error: err.message || 'Failed to create task' }, { status: 500 })
  }
}
