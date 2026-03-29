import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createIssue } from '@/lib/cc-db'
import { logger } from '@/lib/logger'

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

function derivePriority(prompt: string): 'low' | 'medium' | 'high' | 'urgent' {
  const lower = prompt.toLowerCase()
  if (/\b(urgent|asap|blocking|blocked|broken in prod|critical)\b/.test(lower)) return 'urgent'
  if (/\b(high|important|priority)\b/.test(lower)) return 'high'
  return 'medium'
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

    const assigned_to = parseAgentMention(prompt, agents)
    const project_id = parseProjectSlash(prompt, projects, active_project_filter)
    const priority = derivePriority(prompt)

    // Create the task
    const task = await createIssue({
      title,
      description: prompt.trim(),
      status: 'open',
      priority,
      assignee: assigned_to,
      created_by: 'cri',
      project_id: project_id || undefined,
    })

    return NextResponse.json({ task })
  } catch (err: any) {
    logger.error({ err }, 'POST /api/tasks/create-from-prompt error')
    return NextResponse.json({ error: err.message || 'Failed to create task' }, { status: 500 })
  }
}
