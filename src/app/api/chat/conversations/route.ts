import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'

/**
 * GET /api/chat/conversations - List conversations derived from messages
 * Query params: agent (filter by participant), limit, offset
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)

    const agent = searchParams.get('agent')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')

    let conversations: any[]
    let total: number

    if (agent) {
      const result = await db.execute(sql`
        SELECT
          m.conversation_id,
          MAX(m.created_at) as last_message_at,
          COUNT(*) as message_count,
          COUNT(DISTINCT m.from_agent) + COUNT(DISTINCT CASE WHEN m.to_agent IS NOT NULL THEN m.to_agent END) as participant_count,
          SUM(CASE WHEN m.to_agent = ${agent} AND m.read_at IS NULL THEN 1 ELSE 0 END) as unread_count
        FROM messages m
        WHERE m.from_agent = ${agent} OR m.to_agent = ${agent} OR m.to_agent IS NULL
        GROUP BY m.conversation_id
        ORDER BY last_message_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `)
      conversations = result.rows as any[]

      const countResult = await db.execute(sql`
        SELECT COUNT(DISTINCT m.conversation_id) as total
        FROM messages m
        WHERE m.from_agent = ${agent} OR m.to_agent = ${agent} OR m.to_agent IS NULL
      `)
      total = Number((countResult.rows[0] as any)?.total ?? 0)
    } else {
      const result = await db.execute(sql`
        SELECT
          m.conversation_id,
          MAX(m.created_at) as last_message_at,
          COUNT(*) as message_count,
          COUNT(DISTINCT m.from_agent) + COUNT(DISTINCT CASE WHEN m.to_agent IS NOT NULL THEN m.to_agent END) as participant_count,
          0 as unread_count
        FROM messages m
        GROUP BY m.conversation_id
        ORDER BY last_message_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `)
      conversations = result.rows as any[]

      const countResult = await db.execute(sql`SELECT COUNT(DISTINCT conversation_id) as total FROM messages`)
      total = Number((countResult.rows[0] as any)?.total ?? 0)
    }

    // Batch-fetch last message per conversation — single DISTINCT ON query instead of N queries
    let lastMessageMap = new Map<string, any>()
    if (conversations.length > 0) {
      const convIds = conversations.map(c => c.conversation_id)
      const lastMsgsResult = await db.execute(sql`
        SELECT DISTINCT ON (conversation_id) *
        FROM messages
        WHERE conversation_id IN (${sql.join(convIds.map(id => sql`${id}`), sql`, `)})
        ORDER BY conversation_id, created_at DESC
      `)
      for (const row of lastMsgsResult.rows as any[]) {
        lastMessageMap.set(row.conversation_id, row)
      }
    }

    const withLastMessage = conversations.map((conv) => {
      const lastMsg = lastMessageMap.get(conv.conversation_id) ?? null
      return {
        ...conv,
        last_message: lastMsg
          ? { ...lastMsg, metadata: lastMsg.metadata ? JSON.parse(lastMsg.metadata) : null }
          : null,
      }
    })

    return NextResponse.json({ conversations: withLastMessage, total, page: Math.floor(offset / limit) + 1, limit })
  } catch (error) {
    console.error('GET /api/chat/conversations error:', error)
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 })
  }
}
