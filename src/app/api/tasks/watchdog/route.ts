import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getTurns } from '@/lib/cc-db'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dispatchTaskNudge, isAgentAssignee } from '@/lib/task-dispatch'
import { logger } from '@/lib/logger'
import { db } from '@/db/client'
import { issues } from '@/db/schema'
import { eq, and, ne, isNull, or } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

const WATCHDOG_PATH = `${process.env.HOME}/.openclaw/dispatch-watchdog.json`
const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

/**
 * GET /api/tasks/watchdog — Check for stale dispatches and optionally auto-retry
 */
export async function GET(req: Request) {
  const authResult = await requireRole(req, 'viewer')
  if ('error' in authResult) return NextResponse.json({ error: authResult.error }, { status: authResult.status })

  const url = new URL(req.url)
  const autoRetry = url.searchParams.get('auto-retry') === 'true'
  const threshold = parseInt(url.searchParams.get('threshold') || '') || STALE_THRESHOLD_MS

  if (!existsSync(WATCHDOG_PATH)) {
    return NextResponse.json({ stale: [], message: 'No dispatches recorded' })
  }

  const records: Array<{
    taskId: string
    agentId: string
    dispatchedAt: number
    turnCountAtDispatch: number
  }> = JSON.parse(readFileSync(WATCHDOG_PATH, 'utf8'))

  const now = Date.now()
  const stale: typeof records = []
  const healthy: typeof records = []

  for (const rec of records) {
    const age = now - rec.dispatchedAt
    if (age < threshold) {
      healthy.push(rec)
      continue
    }

    const currentTurns = await getTurns(rec.taskId)
    if (currentTurns.length > rec.turnCountAtDispatch) {
      continue
    }

    stale.push(rec)
  }

  const retried: string[] = []
  if (autoRetry) {
    for (const rec of stale) {
      try {
        await dispatchTaskNudge({
          taskId: rec.taskId,
          title: '',
          assignee: rec.agentId,
          reason: 'reassign',
        })
        retried.push(rec.taskId)
      } catch { /* best-effort */ }
    }
  }

  writeFileSync(WATCHDOG_PATH, JSON.stringify(healthy, null, 2))

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

      for (const orphan of orphans) {
        if (!isAgentAssignee(orphan.assignee)) continue
        const isTracked = healthy.some(h => h.taskId === orphan.id)
        if (isTracked) continue

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

  return NextResponse.json({
    stale: stale.map(s => ({
      taskId: s.taskId,
      agentId: s.agentId,
      ageMinutes: Math.round((now - s.dispatchedAt) / 60000),
      retried: retried.includes(s.taskId),
    })),
    healthy: healthy.length,
    orphansDispatched: orphanDispatched.length,
    message: stale.length === 0 && orphanDispatched.length === 0
      ? 'All dispatches healthy'
      : `${stale.length} stale + ${orphanDispatched.length} orphans dispatched`,
  })
}
