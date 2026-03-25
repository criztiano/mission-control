import { NextRequest, NextResponse } from "next/server"
import { db } from '@/db/client'
import { messages } from '@/db/schema'
import { and, asc, eq, inArray, notInArray, isNotNull, sql, SQL } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'

/**
 * GET /api/agents/comms - Inter-agent communication stats and timeline
 * Query params: limit, offset, since, agent
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)

    const limit = parseInt(searchParams.get("limit") || "100")
    const offset = parseInt(searchParams.get("offset") || "0")
    const since = searchParams.get("since")
    const agent = searchParams.get("agent")

    const humanNames = ["human", "system", "operator"]

    // 1. Get inter-agent messages using raw SQL for complex NOT IN filter
    const sinceNum = since ? parseInt(since) : null
    const agentFilter = agent ? agent : null

    const msgRows = await db.execute(sql`
      SELECT * FROM messages
      WHERE to_agent IS NOT NULL
        AND from_agent NOT IN ('human', 'system', 'operator')
        AND to_agent NOT IN ('human', 'system', 'operator')
        ${sinceNum ? sql`AND created_at > ${sinceNum}` : sql``}
        ${agentFilter ? sql`AND (from_agent = ${agentFilter} OR to_agent = ${agentFilter})` : sql``}
      ORDER BY created_at ASC, id ASC
      LIMIT ${limit} OFFSET ${offset}
    `)

    // 2. Communication graph edges
    const edgeRows = await db.execute(sql`
      SELECT
        from_agent, to_agent,
        COUNT(*) as message_count,
        MAX(created_at) as last_message_at
      FROM messages
      WHERE to_agent IS NOT NULL
        AND from_agent NOT IN ('human', 'system', 'operator')
        AND to_agent NOT IN ('human', 'system', 'operator')
        ${sinceNum ? sql`AND created_at > ${sinceNum}` : sql``}
      GROUP BY from_agent, to_agent ORDER BY message_count DESC
    `)

    // 3. Per-agent stats
    const statsRows = await db.execute(sql`
      SELECT agent, SUM(sent) as sent, SUM(received) as received FROM (
        SELECT from_agent as agent, COUNT(*) as sent, 0 as received
        FROM messages WHERE to_agent IS NOT NULL
          AND from_agent NOT IN ('human', 'system', 'operator')
          AND to_agent NOT IN ('human', 'system', 'operator')
        GROUP BY from_agent
        UNION ALL
        SELECT to_agent as agent, 0 as sent, COUNT(*) as received
        FROM messages WHERE to_agent IS NOT NULL
          AND from_agent NOT IN ('human', 'system', 'operator')
          AND to_agent NOT IN ('human', 'system', 'operator')
        GROUP BY to_agent
      ) t GROUP BY agent ORDER BY (sent + received) DESC
    `)

    // 4. Total count
    const countRows = await db.execute(sql`
      SELECT COUNT(*) as total FROM messages
      WHERE to_agent IS NOT NULL
        AND from_agent NOT IN ('human', 'system', 'operator')
        AND to_agent NOT IN ('human', 'system', 'operator')
        ${sinceNum ? sql`AND created_at > ${sinceNum}` : sql``}
        ${agentFilter ? sql`AND (from_agent = ${agentFilter} OR to_agent = ${agentFilter})` : sql``}
    `)

    const total = Number((countRows.rows[0] as any)?.total ?? 0)

    // 5. Seeded count
    const seededRows = await db.execute(sql`
      SELECT COUNT(*) as seeded FROM messages
      WHERE to_agent IS NOT NULL
        AND from_agent NOT IN ('human', 'system', 'operator')
        AND to_agent NOT IN ('human', 'system', 'operator')
        AND conversation_id LIKE 'conv-multi-%'
        ${sinceNum ? sql`AND created_at > ${sinceNum}` : sql``}
        ${agentFilter ? sql`AND (from_agent = ${agentFilter} OR to_agent = ${agentFilter})` : sql``}
    `)
    const seededCount = Number((seededRows.rows[0] as any)?.seeded ?? 0)
    const liveCount = Math.max(0, total - seededCount)
    const source =
      total === 0 ? "empty" :
      liveCount === 0 ? "seeded" :
      seededCount === 0 ? "live" :
      "mixed"

    const parsed = (msgRows.rows as any[]).map((msg) => {
      let parsedMetadata: any = null
      if (msg.metadata) {
        try {
          parsedMetadata = JSON.parse(msg.metadata)
        } catch {
          parsedMetadata = null
        }
      }
      return { ...msg, metadata: parsedMetadata }
    })

    return NextResponse.json({
      messages: parsed,
      total,
      graph: { edges: edgeRows.rows, agentStats: statsRows.rows },
      source: { mode: source, seededCount, liveCount },
    })
  } catch (error) {
    console.error("GET /api/agents/comms error:", error)
    return NextResponse.json({ error: "Failed to fetch agent communications" }, { status: 500 })
  }
}
