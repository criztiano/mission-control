import { NextRequest, NextResponse } from 'next/server'
import { db_helpers } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { getIssue } from '@/lib/cc-db'
import { db } from '@/db/client'
import { agents } from '@/db/schema'
import { inArray } from 'drizzle-orm'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id: taskId } = await params
    const body = await request.json()
    const author = (body.author || 'system') as string
    const message = (body.message || '').trim()

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const issue = await getIssue(taskId)
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const subscriberList = await db_helpers.getTaskSubscribers(parseInt(taskId) || 0)
    const subscribers = new Set(subscriberList)
    subscribers.delete(author)

    if (subscribers.size === 0) {
      return NextResponse.json({ sent: 0, skipped: 0 })
    }

    const subscriberArray = Array.from(subscribers)
    const agentRows = await db
      .select({ name: agents.name, session_key: agents.session_key })
      .from(agents)
      .where(inArray(agents.name, subscriberArray))

    let sent = 0
    let skipped = 0

    for (const agent of agentRows) {
      if (!agent.session_key) {
        skipped += 1
        continue
      }
      try {
        await runOpenClaw(
          [
            'gateway',
            'sessions_send',
            '--session',
            agent.session_key,
            '--message',
            `[Task ${issue.id}] ${issue.title}\nFrom ${author}: ${message}`
          ],
          { timeoutMs: 10000 }
        )
        sent += 1
        await db_helpers.createNotification(
          agent.name,
          'message',
          'Task Broadcast',
          `${author} broadcasted a message on "${issue.title}": ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`,
          'task',
          0
        )
      } catch (error) {
        skipped += 1
      }
    }

    await db_helpers.logActivity(
      'task_broadcast',
      'task',
      0,
      author,
      `Broadcasted message to ${sent} subscribers`,
      { sent, skipped }
    )

    return NextResponse.json({ sent, skipped })
  } catch (error) {
    console.error('POST /api/tasks/[id]/broadcast error:', error)
    return NextResponse.json({ error: 'Failed to broadcast message' }, { status: 500 })
  }
}
