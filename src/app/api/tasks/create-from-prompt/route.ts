import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { issues } from '@/db/schema'
import { getProject, mapIssueToTask, createProject } from '@/lib/cc-db'
import type { IssueStatus } from '@/lib/cc-db'
import { logger } from '@/lib/logger'
import { randomUUID } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestBody {
  prompt: string
  active_project_filter?: string | null
  projects?: Array<{ id: string; title?: string; name?: string; description?: string }>
  agents?: Array<{ id: string; name: string; role?: string }>
}

interface ParsedTask {
  title: string
  description: string
  priority: 'low' | 'normal' | 'high'
  assigned_to: string
  project_id: string | null
  new_project?: { name: string; description: string } | null
}

// ---------------------------------------------------------------------------
// Rule-based fallback parser (runs on Vercel + when gateway unavailable)
// ---------------------------------------------------------------------------

function deriveTitle(text: string): string {
  const clean = text
    .replace(/@[\w-]+/g, '')
    .replace(/\/[\w-]+/g, '')
    .trim()
    .replace(/\s+/g, ' ')

  const firstLine = clean.split('\n')[0].trim()
  // Capitalise, strip trailing punctuation, max 60 chars
  return (firstLine.charAt(0).toUpperCase() + firstLine.slice(1))
    .replace(/[.!?:]+$/, '')
    .replace(/[()]/g, '')
    .slice(0, 60)
}

function parseAgentMention(prompt: string, agents: RequestBody['agents'] = []): string {
  const match = prompt.match(/@([\w-]+)/i)
  if (!match) return 'cri'
  const mention = match[1].toLowerCase()
  const found = agents.find((a) => a.name.toLowerCase() === mention)
  return found ? found.name : mention
}

function parseProjectSlash(
  prompt: string,
  projects: RequestBody['projects'] = [],
  activeFilter: string | null | undefined,
): { id: string | null; createNew: boolean; slugName?: string } {
  const match = prompt.match(/\/(\S+)/i)
  if (match) {
    const slug = match[1].toLowerCase()
    if (slug === 'new') return { id: null, createNew: true }
    const found = projects.find(
      (p) => (p.title || p.name || '').toLowerCase() === slug || p.id.toLowerCase() === slug,
    )
    if (found) return { id: found.id, createNew: false }
    // Project not found — create it
    return { id: null, createNew: true, slugName: match[1] }
  }
  return { id: activeFilter || null, createNew: false }
}

function derivePriority(prompt: string): 'low' | 'normal' | 'high' {
  const lower = prompt.toLowerCase()
  if (/\b(urgent|asap|blocking|broken in prod|critical)\b/.test(lower)) return 'high'
  return 'normal'
}

function ruleBased(body: RequestBody): ParsedTask {
  const { prompt, active_project_filter, projects = [], agents = [] } = body
  const title = deriveTitle(prompt)
  const assigned_to = parseAgentMention(prompt, agents)
  const { id: project_id, createNew, slugName } = parseProjectSlash(prompt, projects, active_project_filter)
  const priority = derivePriority(prompt)

  return {
    title,
    description: prompt.trim(),
    priority,
    assigned_to,
    project_id,
    new_project: createNew
      ? {
          name: slugName ? slugName.slice(0, 20) : 'New Project',
          description: `Created from task: ${title}`,
        }
      : null,
  }
}

// ---------------------------------------------------------------------------
// LLM parser via gateway webhook (local dev only)
// ---------------------------------------------------------------------------

const OPENCLAW_CONFIG = path.join(process.env.HOME || '', '.openclaw/openclaw.json')
const SESSIONS_DIR = path.join(process.env.HOME || '', '.openclaw/agents/main/sessions')
const SESSIONS_JSON = path.join(SESSIONS_DIR, 'sessions.json')
const GATEWAY_URL = `http://${process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1'}:${process.env.OPENCLAW_GATEWAY_PORT || '18789'}`

function getHookToken(): string {
  try {
    if (!existsSync(OPENCLAW_CONFIG)) return ''
    const config = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8'))
    return config.hooks?.token || ''
  } catch { return '' }
}

function extractJsonFromSession(sessionKey: string): ParsedTask | null {
  try {
    if (!existsSync(SESSIONS_JSON)) return null
    const sessions = JSON.parse(readFileSync(SESSIONS_JSON, 'utf-8'))
    const fullKey = `agent:main:${sessionKey}`
    const session = sessions[fullKey] || sessions[sessionKey]
    if (!session?.sessionId) return null

    const transcriptPath = path.join(SESSIONS_DIR, `${session.sessionId}.jsonl`)
    if (!existsSync(transcriptPath)) return null

    const lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n')
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.type !== 'message') continue
        const msg = entry.message
        if (msg?.role !== 'assistant') continue
        const content = msg.content
        if (!Array.isArray(content)) continue
        for (const block of content) {
          if (block.type !== 'text') continue
          const text = block.text as string
          const match = text.match(/\{[\s\S]*?"title"\s*:/m)
          if (match) {
            const jsonStart = text.indexOf(match[0])
            const jsonStr = text.slice(jsonStart)
            const end = jsonStr.indexOf('\n}') + 2
            try {
              const parsed = JSON.parse(end > 1 ? jsonStr.slice(0, end) : jsonStr)
              if (parsed.title) return parsed as ParsedTask
            } catch {}
          }
        }
      } catch {}
    }
    return null
  } catch { return null }
}

async function pollForLLMResult(sessionKey: string, maxWaitMs = 12000): Promise<ParsedTask | null> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const result = extractJsonFromSession(sessionKey)
    if (result) return result
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

async function llmParse(body: RequestBody): Promise<ParsedTask | null> {
  try {
    const token = getHookToken()
    if (!token) return null

    const requestId = randomUUID().slice(0, 8)
    const sessionKey = `hook:eden:task-create-${requestId}`

    const projectList = (body.projects || [])
      .map((p) => `- ${p.title || p.name || p.id}: ${p.description || ''}`)
      .join('\n')

    const agentList = (body.agents || [])
      .map((a) => `- @${a.name}: ${a.role || ''}`)
      .join('\n')

    const systemPrompt = [
      'You are a task creation assistant. Parse the user prompt and return ONLY a raw JSON object.',
      '',
      '## Title Rules',
      '- Start with a verb (Fix, Build, Add, Update, Implement, etc.)',
      '- Max 60 chars, concise',
      '- Use – (en-dash) to separate context from action: "Eden – Add batch delete endpoint"',
      '- NO parentheses, periods, colons, exclamation marks, quotes',
      '- NO filler ("Please", "We need to"), NO status words ("TODO", "URGENT")',
      '',
      '## Assignment Rules',
      '- Default: "cri" (creates draft for the human)',
      '- Only assign to an agent if @mentioned in the prompt',
      `- Available agents: ${(body.agents || []).map((a) => '@' + a.name).join(', ') || 'none'}`,
      '',
      '## Priority Rules',
      '- "normal" always, unless user says: urgent/ASAP/blocking/critical/broken in prod',
      '- Binary: "normal" or "high" only',
      '',
      '## Project Resolution',
      '- If prompt has /slash: find matching project by name or slug',
      '- If /new: set new_project with a 1-2 word name',
      '- If no /slash: infer from project list or active_filter',
      '- Code tasks (build/fix/implement/API) MUST have a project',
      `- Active filter: ${body.active_project_filter || 'none'}`,
      '',
      '## Available Projects',
      projectList || '(none)',
      '',
      '## Available Agents',
      agentList || '(none)',
      '',
      '## Response Format',
      'Respond with ONLY this JSON (no markdown, no code blocks):',
      '{',
      '  "title": "string",',
      '  "description": "string",',
      '  "priority": "normal" | "high",',
      '  "assigned_to": "cri" | "<agent_name>",',
      '  "project_id": "<id>" | null,',
      '  "new_project": {"name": "short name", "description": "1 sentence"} | null',
      '}',
    ].join('\n')

    const userPrompt = `Parse this task creation prompt:\n\n${body.prompt}`

    const res = await fetch(`${GATEWAY_URL}/hooks/agent`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `${systemPrompt}\n\n${userPrompt}`,
        name: 'TaskCreate',
        sessionKey,
        model: 'anthropic/claude-haiku-4-5',
        deliver: false,
        wakeMode: 'next-heartbeat',
        timeoutSeconds: 15,
      }),
    })

    if (!res.ok) return null

    const result = await pollForLLMResult(sessionKey, 12000)
    return result
  } catch (err) {
    logger.warn({ err }, 'LLM task parse failed, using rule-based fallback')
    return null
  }
}

// ---------------------------------------------------------------------------
// POST /api/tasks/create-from-prompt
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body: RequestBody = await request.json()
    const { prompt } = body

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }

    // Try LLM first; fall back to rule-based
    let parsed = await llmParse(body)
    if (!parsed || !parsed.title) {
      parsed = ruleBased(body)
    }

    const { title, description, priority, assigned_to, project_id: parsedProjectId, new_project } = parsed

    if (!title) {
      return NextResponse.json({ error: 'Could not derive title from prompt' }, { status: 400 })
    }

    const creator = (auth as any).user?.username || 'cri'
    const now = new Date().toISOString()
    const id = randomUUID()

    // Create new project if needed
    let finalProjectId = parsedProjectId
    let createdProject: { id: string; name?: string; title?: string } | null = null

    if (new_project?.name && !finalProjectId) {
      try {
        const proj = await createProject(
          new_project.name,
          new_project.description || '',
          '📋',
        )
        finalProjectId = proj.id
        createdProject = proj
      } catch (e) {
        logger.warn({ err: e }, 'Failed to create new project from prompt')
      }
    }

    // Map priority to DB format
    const dbPriority = priority === 'high' ? 'high' : 'normal'

    await db.insert(issues).values({
      id,
      title,
      description: description || prompt.trim(),
      status: 'open' as IssueStatus,
      assignee: assigned_to,
      creator,
      priority: dbPriority,
      project_id: finalProjectId || null,
      created_at: now,
      updated_at: now,
      archived: false,
      blocked_by: '[]',
      schedule: '',
    })

    const projectTitle = finalProjectId
      ? (createdProject as any)?.title || (await getProject(finalProjectId))?.title
      : undefined

    const task = mapIssueToTask({
      id,
      title,
      description: description || prompt.trim(),
      status: 'open' as IssueStatus,
      assignee: assigned_to,
      creator,
      priority: dbPriority,
      project_id: finalProjectId || null,
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

    return NextResponse.json({
      task,
      ...(createdProject ? { new_project: createdProject } : {}),
    })
  } catch (err: any) {
    logger.error({ err }, 'POST /api/tasks/create-from-prompt error')
    return NextResponse.json({ error: err.message || 'Failed to create task' }, { status: 500 })
  }
}
