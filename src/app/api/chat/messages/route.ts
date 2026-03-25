import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { db_helpers } from '@/lib/db'
import { messages } from '@/db/schema'
import { eq, asc, and, gt, sql } from 'drizzle-orm'
import { runOpenClaw } from '@/lib/command'
import { getAllGatewaySessions } from '@/lib/sessions'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'

type ForwardInfo = {
  attempted: boolean
  delivered: boolean
  reason?: string
  session?: string
  runId?: string
}

const COORDINATOR_AGENT =
  String(process.env.MC_COORDINATOR_AGENT || process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator').trim() ||
  'coordinator'

function parseGatewayJson(raw: string): any | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

async function createChatReply(
  conversationId: string,
  fromAgent: string,
  toAgent: string,
  content: string,
  messageType: 'text' | 'status' = 'status',
  metadata: Record<string, any> | null = null
) {
  const rows = await db
    .insert(messages)
    .values({
      conversation_id: conversationId,
      from_agent: fromAgent,
      to_agent: toAgent,
      content,
      message_type: messageType,
      metadata: metadata ? JSON.stringify(metadata) : null,
      created_at: Math.floor(Date.now() / 1000),
    })
    .returning()

  const row = rows[0]
  eventBus.broadcast('chat.message', {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  })
}

function extractReplyText(waitPayload: any): string | null {
  if (!waitPayload || typeof waitPayload !== 'object') return null

  const directCandidates = [
    waitPayload.text,
    waitPayload.message,
    waitPayload.response,
    waitPayload.output,
    waitPayload.result,
  ]
  for (const value of directCandidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  if (typeof waitPayload.output === 'object' && waitPayload.output) {
    const nested = [
      waitPayload.output.text,
      waitPayload.output.message,
      waitPayload.output.content,
    ]
    for (const value of nested) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }

  return null
}

/**
 * GET /api/chat/messages - List messages with filters
 * Query params: conversation_id, from_agent, to_agent, limit, offset, since
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)

    const conversation_id = searchParams.get('conversation_id')
    const from_agent = searchParams.get('from_agent')
    const to_agent = searchParams.get('to_agent')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')
    const since = searchParams.get('since')

    // Build where conditions
    const conditions = []
    if (conversation_id) conditions.push(eq(messages.conversation_id, conversation_id))
    if (from_agent) conditions.push(eq(messages.from_agent, from_agent))
    if (to_agent) conditions.push(eq(messages.to_agent, to_agent))
    if (since) conditions.push(gt(messages.created_at, parseInt(since)))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await db
      .select()
      .from(messages)
      .where(whereClause)
      .orderBy(asc(messages.created_at))
      .limit(limit)
      .offset(offset)

    const parsed = rows.map((msg) => ({
      ...msg,
      metadata: msg.metadata ? JSON.parse(msg.metadata) : null,
    }))

    // Get total count
    const countResult = await db
      .select({ total: sql<number>`count(*)` })
      .from(messages)
      .where(whereClause)

    const total = Number(countResult[0]?.total ?? 0)

    return NextResponse.json({ messages: parsed, total, page: Math.floor(offset / limit) + 1, limit })
  } catch (error) {
    console.error('GET /api/chat/messages error:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

/**
 * POST /api/chat/messages - Send a new message
 * Body: { from, to, content, message_type, conversation_id, metadata }
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()

    const from = (body.from || '').trim()
    const to = body.to ? (body.to as string).trim() : null
    const content = (body.content || '').trim()
    const message_type = body.message_type || 'text'
    const conversation_id = body.conversation_id || `conv_${Date.now()}`
    const metadata = body.metadata || null

    if (!from || !content) {
      return NextResponse.json(
        { error: '"from" and "content" are required' },
        { status: 400 }
      )
    }

    const inserted = await db
      .insert(messages)
      .values({
        conversation_id,
        from_agent: from,
        to_agent: to,
        content,
        message_type,
        metadata: metadata ? JSON.stringify(metadata) : null,
        created_at: Math.floor(Date.now() / 1000),
      })
      .returning()

    const messageId = inserted[0].id
    let forwardInfo: ForwardInfo | null = null

    // Log activity
    await db_helpers.logActivity(
      'chat_message',
      'message',
      messageId,
      from,
      `Sent ${message_type} message${to ? ` to ${to}` : ' (broadcast)'}`,
      { conversation_id, to, message_type }
    )

    // Create notification for recipient if specified
    if (to) {
      await db_helpers.createNotification(
        to,
        'chat_message',
        `Message from ${from}`,
        content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        'message',
        messageId
      )

      // Optionally forward to agent via gateway
      if (body.forward) {
        forwardInfo = { attempted: true, delivered: false }

        const agentRows = await db.execute(sql`SELECT * FROM agents WHERE lower(name) = lower(${to}) LIMIT 1`)
        const agent = (agentRows.rows as any[])[0] ?? null

        let sessionKey: string | null = agent?.session_key || null

        // Fallback: derive session from on-disk gateway session stores
        if (!sessionKey) {
          const sessions = getAllGatewaySessions()
          const match = sessions.find(
            (s) => s.agent.toLowerCase() === String(to).toLowerCase()
          )
          sessionKey = match?.key || match?.sessionId || null
        }

        // Prefer configured openclawId when present, fallback to normalized name
        let openclawAgentId: string | null = null
        if (agent?.config) {
          try {
            const cfg = JSON.parse(agent.config)
            if (cfg?.openclawId && typeof cfg.openclawId === 'string') {
              openclawAgentId = cfg.openclawId
            }
          } catch {
            // ignore parse issues
          }
        }
        if (!openclawAgentId && typeof to === 'string') {
          openclawAgentId = to.toLowerCase().replace(/\s+/g, '-')
        }

        if (!sessionKey && !openclawAgentId) {
          forwardInfo.reason = 'no_active_session'

          if (typeof conversation_id === 'string' && conversation_id.startsWith('coord:')) {
            try {
              await createChatReply(
                conversation_id,
                COORDINATOR_AGENT,
                from,
                'I received your message, but my live coordinator session is offline right now. Start/restore the coordinator session and retry.',
                'status',
                { status: 'offline', reason: 'no_active_session' }
              )
            } catch (e) {
              console.error('Failed to create offline status reply:', e)
            }
          }
        } else {
          try {
            const invokeParams: any = {
              message: `Message from ${from}: ${content}`,
              idempotencyKey: `mc-${messageId}-${Date.now()}`,
              deliver: false,
            }
            if (sessionKey) invokeParams.sessionKey = sessionKey
            else invokeParams.agentId = openclawAgentId

            const invokeResult = await runOpenClaw(
              [
                'gateway',
                'call',
                'agent',
                '--timeout',
                '10000',
                '--params',
                JSON.stringify(invokeParams),
                '--json',
              ],
              { timeoutMs: 12000 }
            )
            const acceptedPayload = parseGatewayJson(invokeResult.stdout)
            forwardInfo.delivered = true
            forwardInfo.session = sessionKey || openclawAgentId || undefined
            if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
              forwardInfo.runId = acceptedPayload.runId
            }
          } catch (err) {
            const maybeStdout = String((err as any)?.stdout || '')
            const acceptedPayload = parseGatewayJson(maybeStdout)
            if (maybeStdout.includes('"status": "accepted"') || maybeStdout.includes('"status":"accepted"')) {
              forwardInfo.delivered = true
              forwardInfo.session = sessionKey || openclawAgentId || undefined
              if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
                forwardInfo.runId = acceptedPayload.runId
              }
            } else {
              forwardInfo.reason = 'gateway_send_failed'
              console.error('Failed to forward message via gateway:', err)

              if (typeof conversation_id === 'string' && conversation_id.startsWith('coord:')) {
                try {
                  await createChatReply(
                    conversation_id,
                    COORDINATOR_AGENT,
                    from,
                    'I received your message, but delivery to the live coordinator runtime failed. Please restart the coordinator/gateway session and retry.',
                    'status',
                    { status: 'delivery_failed', reason: 'gateway_send_failed' }
                  )
                } catch (e) {
                  console.error('Failed to create gateway failure status reply:', e)
                }
              }
            }
          }

          if (
            typeof conversation_id === 'string' &&
            conversation_id.startsWith('coord:') &&
            forwardInfo.delivered
          ) {
            try {
              await createChatReply(
                conversation_id,
                COORDINATOR_AGENT,
                from,
                'Received. I am coordinating downstream agents now.',
                'status',
                { status: 'accepted', runId: forwardInfo.runId || null }
              )
            } catch (e) {
              console.error('Failed to create accepted status reply:', e)
            }

            if (forwardInfo.runId) {
              try {
                const waitResult = await runOpenClaw(
                  [
                    'gateway',
                    'call',
                    'agent.wait',
                    '--timeout',
                    '8000',
                    '--params',
                    JSON.stringify({ runId: forwardInfo.runId, timeoutMs: 6000 }),
                    '--json',
                  ],
                  { timeoutMs: 9000 }
                )

                const waitPayload = parseGatewayJson(waitResult.stdout)
                const waitStatus = String(waitPayload?.status || '').toLowerCase()

                if (waitStatus === 'error') {
                  const reason =
                    typeof waitPayload?.error === 'string'
                      ? waitPayload.error
                      : 'Unknown runtime error'
                  await createChatReply(
                    conversation_id,
                    COORDINATOR_AGENT,
                    from,
                    `I received your message, but execution failed: ${reason}`,
                    'status',
                    { status: 'error', runId: forwardInfo.runId }
                  )
                } else if (waitStatus === 'timeout') {
                  await createChatReply(
                    conversation_id,
                    COORDINATOR_AGENT,
                    from,
                    'I received your message and I am still processing it. I will post results as soon as execution completes.',
                    'status',
                    { status: 'processing', runId: forwardInfo.runId }
                  )
                } else {
                  const replyText = extractReplyText(waitPayload)
                  if (replyText) {
                    await createChatReply(
                      conversation_id,
                      COORDINATOR_AGENT,
                      from,
                      replyText,
                      'text',
                      { status: waitStatus || 'completed', runId: forwardInfo.runId }
                    )
                  } else {
                    await createChatReply(
                      conversation_id,
                      COORDINATOR_AGENT,
                      from,
                      'Execution accepted and completed. No textual response payload was returned by the runtime.',
                      'status',
                      { status: waitStatus || 'completed', runId: forwardInfo.runId }
                    )
                  }
                }
              } catch (waitErr) {
                const maybeWaitStdout = String((waitErr as any)?.stdout || '')
                const maybeWaitStderr = String((waitErr as any)?.stderr || '')
                const waitPayload = parseGatewayJson(maybeWaitStdout)
                const reason =
                  typeof waitPayload?.error === 'string'
                    ? waitPayload.error
                    : (maybeWaitStderr || maybeWaitStdout || 'Unable to read completion status from coordinator runtime.').trim()

                await createChatReply(
                  conversation_id,
                  COORDINATOR_AGENT,
                  from,
                  `I received your message, but I could not retrieve completion output yet: ${reason}`,
                  'status',
                  { status: 'unknown', runId: forwardInfo.runId }
                )
              }
            }
          }
        }
      }
    }

    const createdRows = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1)
    const created = createdRows[0]
    const parsedMessage = {
      ...created,
      metadata: created.metadata ? JSON.parse(created.metadata) : null,
    }

    // Broadcast to SSE clients
    eventBus.broadcast('chat.message', parsedMessage)

    return NextResponse.json({ message: parsedMessage, forward: forwardInfo }, { status: 201 })
  } catch (error) {
    console.error('POST /api/chat/messages error:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
