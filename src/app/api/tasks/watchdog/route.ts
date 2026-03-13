import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getTurns } from '@/lib/cc-db'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dispatchTaskNudge } from '@/lib/task-dispatch'

const WATCHDOG_PATH = `${process.env.HOME}/.openclaw/dispatch-watchdog.json`
const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes without a new turn = stale

/**
 * GET /api/tasks/watchdog — Check for stale dispatches and optionally auto-retry
 * 
 * Query params:
 *   ?auto-retry=true  — automatically re-poke stale tasks
 *   ?threshold=300000 — custom staleness threshold in ms (default 5 min)
 */
export async function GET(req: Request) {
  const authResult = requireRole(req, 'viewer')
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
      healthy.push(rec) // too fresh to judge
      continue
    }

    // Check if new turns were posted since dispatch
    const currentTurns = getTurns(rec.taskId)
    if (currentTurns.length > rec.turnCountAtDispatch) {
      // Agent posted a turn — healthy, remove from watchdog
      continue
    }

    // No new turns after threshold — stale
    stale.push(rec)
  }

  // Auto-retry stale dispatches
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

  // Update watchdog file — keep only healthy (non-stale, non-completed) entries
  writeFileSync(WATCHDOG_PATH, JSON.stringify(healthy, null, 2))

  return NextResponse.json({
    stale: stale.map(s => ({
      taskId: s.taskId,
      agentId: s.agentId,
      ageMinutes: Math.round((now - s.dispatchedAt) / 60000),
      retried: retried.includes(s.taskId),
    })),
    healthy: healthy.length,
    message: stale.length === 0 ? 'All dispatches healthy' : `${stale.length} stale dispatch(es) found`,
  })
}
