import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { db_helpers } from '@/lib/db'
import { agents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { runOpenClaw } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { validateBody, createMessageSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, createMessageSchema)
    if ('error' in result) return result.error
    const { from, to, message } = result.data

    const agentRows = await db.select().from(agents).where(eq(agents.name, to)).limit(1)
    const agent = agentRows[0]
    if (!agent) {
      return NextResponse.json({ error: 'Recipient agent not found' }, { status: 404 })
    }
    if (!agent.session_key) {
      return NextResponse.json(
        { error: 'Recipient agent has no session key configured' },
        { status: 400 }
      )
    }

    await runOpenClaw(
      [
        'gateway',
        'sessions_send',
        '--session',
        agent.session_key,
        '--message',
        `Message from ${from}: ${message}`
      ],
      { timeoutMs: 10000 }
    )

    await db_helpers.createNotification(
      to,
      'message',
      'Direct Message',
      `${from}: ${message.substring(0, 200)}${message.length > 200 ? '...' : ''}`,
      'agent',
      agent.id
    )

    await db_helpers.logActivity(
      'agent_message',
      'agent',
      agent.id,
      from,
      `Sent message to ${to}`,
      { to }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('POST /api/agents/message error:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
