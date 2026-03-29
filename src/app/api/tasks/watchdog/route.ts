import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getTurns } from '@/lib/cc-db'
import { dispatchTaskNudge, isAgentAssignee, markDispatchCompleted } from '@/lib/task-dispatch'
import { logger } from '@/lib/logger'
import { db } from '@/db/client'
import { issues, dispatchQueue } from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'

const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
const MAX_RETRIES = 3

/**
 * GET /api/tasks/watchdog — Check for stale dispatches and optionally auto-retry
 * 
 * Now uses dispatch_queue table (works on Vercel) instead of filesystem JSON.
 */
export async function GET(req: Request) {
  const authResult = await requireRole(req, 'viewer')
  if ('error' in authResult) return NextResponse.json({ error: authResult.error }, { status: authResult.status })

  const url = new URL(req.url)
  const autoRetry = url.searchParams.get('auto-retry') === 'true'
  const threshold = parseInt(url.searchParams.get('threshold') || '') || STALE_THRESHOLD_MS

  const now = Date.now()

  // 1. Check dispatched entries for staleness
  const dispatched = await db.select()
    .from(dispatchQueue)
    .where(eq(dispatchQueue.status, 'dispatched'))

  const stale: Array<{ taskId: string; agentId: string; ageMinutes: number; retried: boolean }> = []
  const healthy: string[] = []
  const completed: string[] = []

  for (const rec of dispatched) {
    const dispatchedAt = rec.dispatched_at ? new Date(rec.dispatched_at).getTime() : 0
    const age = now - dispatchedAt

    // Check if agent posted a turn since dispatch
    const currentTurns = await getTurns(rec.task_id)
    if (currentTurns.length > (rec.turn_count_at_dispatch || 0)) {
      // Agent completed — mark as done
      await markDispatchCompleted(rec.task_id, rec.agent_id)
      completed.push(rec.task_id)
      continue
    }

    if (age < threshold) {
      healthy.push(rec.task_id)
      continue
    }

    // Stale dispatch
    const retried = autoRetry && (rec.retry_count || 0) < MAX_RETRIES
    stale.push({
      taskId: rec.task_id,
      agentId: rec.agent_id,
      ageMinutes: Math.round(age / 60000),
      retried,
    })

    if (retried) {
      try {
        // Increment retry count
        await db.update(dispatchQueue)
          .set({ retry_count: (rec.retry_count || 0) + 1 })
          .where(eq(dispatchQueue.id, rec.id))

        // Reset picked so dispatch can re-pick
        await db.update(issues)
          .set({ picked: false, picked_at: null })
          .where(eq(issues.id, rec.task_id))

        await dispatchTaskNudge({
          taskId: rec.task_id,
          title: '',
          assignee: rec.agent_id,
          reason: 'reassign',
        })
      } catch (e) {
        logger.warn({ err: e, taskId: rec.task_id }, 'watchdog: retry failed')
      }
    } else if (autoRetry && (rec.retry_count || 0) >= MAX_RETRIES) {
      // Max retries hit — mark as failed, reset picked
      await db.update(dispatchQueue)
        .set({ status: 'failed' })
        .where(eq(dispatchQueue.id, rec.id))
      await db.update(issues)
        .set({ picked: false, picked_at: null })
        .where(eq(issues.id, rec.task_id))
      logger.warn({ taskId: rec.task_id, agentId: rec.agent_id }, 'watchdog: max retries — marked failed')
    }
  }

  // 2. Orphan scan: open tasks assigned to agents that aren't picked and aren't tracked
  const orphanDispatched: string[] = []
  if (autoRetry) {
    try {
      const orphanRows = await db.execute(sql`
        SELECT id, title, assignee FROM issues
        WHERE status = 'open'
          AND (picked = false OR picked IS NULL)
          AND assignee != ''
          AND assignee IS NOT NULL
          AND LOWER(assignee) != 'cri'
      `)

      const orphans = orphanRows.rows as { id: string; title: string; assignee: string }[]

      // Get all currently tracked task IDs
      const trackedIds = new Set(dispatched.map(d => d.task_id))

      for (const orphan of orphans) {
        if (!isAgentAssignee(orphan.assignee)) continue
        if (trackedIds.has(orphan.id)) continue
        // Also skip if in completed list
        if (completed.includes(orphan.id)) continue

        logger.info({ taskId: orphan.id, assignee: orphan.assignee }, 'watchdog: orphaned task found, dispatching')
        try {
          await dispatchTaskNudge({
            taskId: orphan.id,
            title: orphan.title,
            assignee: orphan.assignee,
            reason: 'reassign',
          })
          orphanDispatched.push(orphan.id)
        } catch { /* best-effort */ }
      }
    } catch (e) {
      logger.warn({ err: e }, 'watchdog: orphan scan failed')
    }
  }

  // 3. Cleanup old completed/failed entries (>24h)
  try {
    await db.execute(sql`
      DELETE FROM dispatch_queue
      WHERE status IN ('completed', 'failed')
        AND created_at < ${new Date(now - 24 * 60 * 60 * 1000).toISOString()}
    `)
  } catch { /* best-effort */ }

  return NextResponse.json({
    stale,
    healthy: healthy.length,
    completed: completed.length,
    orphansDispatched: orphanDispatched.length,
    message: stale.length === 0 && orphanDispatched.length === 0
      ? 'All dispatches healthy'
      : `${stale.length} stale + ${orphanDispatched.length} orphans dispatched`,
  })
}
