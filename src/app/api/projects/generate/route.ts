import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import path from 'path'
import { db } from '@/db/client'
import { issues, projects } from '@/db/schema'
import { eq } from 'drizzle-orm'

const OPENCLAW_CONFIG = path.join(process.env.HOME || '', '.openclaw/openclaw.json')
const SESSIONS_DIR = path.join(process.env.HOME || '', '.openclaw/agents/main/sessions')
const SESSIONS_JSON = path.join(SESSIONS_DIR, 'sessions.json')

const GATEWAY_URL = 'http://127.0.0.1:18789'

function getHookToken(): string {
  const config = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8'))
  return config.hooks?.token || ''
}

async function callWebhook(taskTitle: string, taskDescription: string, sessionKey: string): Promise<boolean> {
  const token = getHookToken()

  const prompt = [
    'Generate a project identity from this task.',
    'Respond with ONLY a raw JSON object (no markdown, no code blocks, no explanation):',
    '{"name": "short catchy 1-2 word name", "emoji": "single emoji", "description": "one sentence"}',
    '',
    'Rules for name: Extract the core concept. Strip generic prefixes (Build, Create, Implement, Design, Add). Max 2 words, catchy and memorable.',
    '',
    `Task title: ${taskTitle}`,
    taskDescription ? `Task description: ${taskDescription}` : '',
  ].filter(Boolean).join('\n')

  const res = await fetch(`${GATEWAY_URL}/hooks/agent`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: prompt,
      name: 'ProjectGen',
      sessionKey,
      model: 'nvidia-nim/moonshotai/kimi-k2.5',
      deliver: false,
      wakeMode: 'next-heartbeat',
      timeoutSeconds: 30,
    }),
  })

  if (!res.ok) return false
  const data = await res.json()
  return data.ok === true
}

function extractProjectFromSession(sessionKey: string): { name: string; emoji: string; description: string } | null {
  try {
    // Read sessions.json to find the sessionId for this key
    const sessions = JSON.parse(readFileSync(SESSIONS_JSON, 'utf-8'))
    // OpenClaw prefixes session keys with "agent:main:" in sessions.json
    const fullKey = `agent:main:${sessionKey}`
    const session = sessions[fullKey] || sessions[sessionKey]
    if (!session?.sessionId) return null

    const transcriptPath = path.join(SESSIONS_DIR, `${session.sessionId}.jsonl`)
    if (!existsSync(transcriptPath)) return null

    const lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n')

    for (const line of lines) {
      const entry = JSON.parse(line)
      if (entry.type !== 'message') continue
      const msg = entry.message
      if (msg?.role !== 'assistant') continue

      const content = msg.content
      if (!Array.isArray(content)) continue

      for (const block of content) {
        if (block.type !== 'text') continue
        const text = block.text as string

        // Extract JSON with name/emoji/description
        const match = text.match(/\{[^{}]*"name"\s*:\s*"[^"]*"[^{}]*"emoji"\s*:\s*"[^"]*"[^{}]*"description"\s*:\s*"[^"]*"[^{}]*\}/)
        if (match) {
          try {
            const parsed = JSON.parse(match[0])
            if (parsed.name && parsed.emoji) return parsed
          } catch { /* continue */ }
        }
      }
    }
    return null
  } catch {
    return null
  }
}

async function pollForResult(
  sessionKey: string,
  maxWaitMs: number = 20000,
  intervalMs: number = 500
): Promise<{ name: string; emoji: string; description: string } | null> {
  const start = Date.now()

  while (Date.now() - start < maxWaitMs) {
    const result = extractProjectFromSession(sessionKey)
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  return null
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { taskId } = body

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
    }

    // Read the task from DB via Drizzle
    const [task] = await db
      .select({ title: issues.title, description: issues.description })
      .from(issues)
      .where(eq(issues.id, taskId))
      .limit(1)

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Use a unique session key per request to avoid stale reads
    const requestId = randomUUID().slice(0, 8)
    const sessionKey = `hook:eden:project-gen-${requestId}`

    // Fire the webhook
    const ok = await callWebhook(task.title, task.description || '', sessionKey)
    if (!ok) {
      return NextResponse.json({ error: 'Failed to call webhook' }, { status: 502 })
    }

    // Poll the transcript for the AI response
    const projectData = await pollForResult(sessionKey)

    if (!projectData) {
      // Fallback: strip common prefixes from title
      const fallbackName = task.title.replace(/^(Build|Create|Implement|Design|Add|Set up)\s+/i, '')
      return NextResponse.json({
        id: null,
        name: fallbackName,
        emoji: '📁',
        description: task.description || '',
        fallback: true,
      })
    }

    // Create the project in DB via Drizzle
    const projectId = randomUUID()
    const now = new Date().toISOString()

    await db.insert(projects).values({
      id: projectId,
      title: projectData.name,
      description: projectData.description,
      emoji: projectData.emoji,
      created_at: now,
      updated_at: now,
    })

    // Assign the project to the task
    await db
      .update(issues)
      .set({ project_id: projectId, updated_at: now })
      .where(eq(issues.id, taskId))

    return NextResponse.json({
      id: projectId,
      name: projectData.name,
      emoji: projectData.emoji,
      description: projectData.description,
      fallback: false,
    })
  } catch (error) {
    console.error('Project generation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
