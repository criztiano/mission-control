import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { dispatchQueue, issues } from '@/db/schema'
import { eq, sql, desc, and, gte } from 'drizzle-orm'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/**
 * GET /api/dispatch/health
 *
 * Returns dispatch system status:
 * - dispatch_queue row counts by status
 * - recent dispatch stats (last 24h)
 * - stuck dispatches (dispatched >30min ago, no completion)
 * - webhook reachability (DISPATCH_URL configured check)
 * - DISPATCH_URL/DISPATCH_TOKEN presence
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString()

    // Queue status counts
    const [statusCounts, recentStats, stuckDispatches, pickedTasks] = await Promise.all([
      // All queue entries by status
      db.execute(sql`
        SELECT status, COUNT(*)::int as count
        FROM dispatch_queue
        GROUP BY status
        ORDER BY status
      `),

      // Recent dispatches (last 24h)
      db.execute(sql`
        SELECT
          COUNT(*)::int as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::int as completed,
          SUM(CASE WHEN status = 'dispatched' THEN 1 ELSE 0 END)::int as in_flight,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int as failed,
          SUM(CASE WHEN retry_count > 0 THEN 1 ELSE 0 END)::int as retried
        FROM dispatch_queue
        WHERE created_at > ${oneDayAgo}
      `),

      // Stuck: dispatched >30 min ago and still 'dispatched' (not completed)
      db.execute(sql`
        SELECT dq.id, dq.task_id, dq.agent_id, dq.dispatched_at, dq.retry_count,
               i.title as task_title
        FROM dispatch_queue dq
        LEFT JOIN issues i ON i.id = dq.task_id
        WHERE dq.status = 'dispatched'
          AND dq.dispatched_at < ${thirtyMinAgo}
        ORDER BY dq.dispatched_at ASC
        LIMIT 20
      `),

      // Picked tasks with no recent dispatch queue entry (orphan picks)
      db.execute(sql`
        SELECT i.id, i.title, i.assignee, i.picked_at,
               dq.id as queue_id, dq.status as queue_status
        FROM issues i
        LEFT JOIN dispatch_queue dq ON dq.task_id = i.id AND dq.status IN ('dispatched', 'pending')
        WHERE i.picked = true
          AND i.archived = false
          AND i.status = 'open'
        ORDER BY i.picked_at DESC
        LIMIT 20
      `),
    ])

    // Check webhook config
    const dispatchUrl = process.env.DISPATCH_URL || null
    const hasToken = !!(process.env.DISPATCH_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN)
    const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)

    // Webhook reachability (quick check — don't actually send a message)
    let webhookReachable: boolean | null = null
    if (dispatchUrl) {
      try {
        const pingUrl = dispatchUrl.replace('/hooks/agent', '/health')
        const resp = await fetch(pingUrl, { signal: AbortSignal.timeout(3000) })
        webhookReachable = resp.ok
      } catch {
        webhookReachable = false
      }
    }

    const statusMap: Record<string, number> = {}
    for (const row of statusCounts.rows as any[]) {
      statusMap[row.status] = row.count
    }

    const recent = (recentStats.rows[0] || {}) as any

    return NextResponse.json({
      ok: true,
      environment: {
        is_serverless: isServerless,
        dispatch_url_configured: !!dispatchUrl,
        dispatch_url: dispatchUrl ? dispatchUrl.replace(/\/\/[^@]+@/, '//***@') : null,
        token_configured: hasToken,
        webhook_reachable: webhookReachable,
      },
      queue: {
        by_status: statusMap,
        pending: statusMap['pending'] ?? 0,
        dispatched: statusMap['dispatched'] ?? 0,
        completed: statusMap['completed'] ?? 0,
        failed: statusMap['failed'] ?? 0,
      },
      recent_24h: {
        total: recent.total ?? 0,
        completed: recent.completed ?? 0,
        in_flight: recent.in_flight ?? 0,
        failed: recent.failed ?? 0,
        retried: recent.retried ?? 0,
      },
      stuck_dispatches: {
        count: (stuckDispatches.rows as any[]).length,
        items: stuckDispatches.rows,
      },
      picked_tasks: {
        count: (pickedTasks.rows as any[]).length,
        items: pickedTasks.rows,
      },
      warnings: [
        isServerless && !dispatchUrl
          ? 'DISPATCH_URL is not set — tasks cannot be dispatched to agents on Vercel. Set DISPATCH_URL=https://<gateway-funnel>/hooks/agent'
          : null,
        isServerless && !hasToken
          ? 'DISPATCH_TOKEN (or OPENCLAW_GATEWAY_TOKEN) is not set — webhook auth will fail'
          : null,
        dispatchUrl && webhookReachable === false
          ? `Webhook at ${dispatchUrl} is not reachable`
          : null,
        (stuckDispatches.rows as any[]).length > 0
          ? `${(stuckDispatches.rows as any[]).length} dispatch(es) stuck >30 min without completion`
          : null,
      ].filter(Boolean),
    })
  } catch (err: any) {
    logger.error({ err }, 'GET /api/dispatch/health error')
    return NextResponse.json({ error: err.message, ok: false }, { status: 500 })
  }
}
