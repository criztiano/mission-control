import { logAuditEvent } from './db'
import { syncAgentsFromConfig } from './agent-sync'
import { config } from './config'
import { db } from '@/db/client'
import { settings, agents, activities, notifications } from '@/db/schema'
import { eq, lt, and, ne, isNull, or, sql } from 'drizzle-orm'
import { logger } from './logger'

interface ScheduledTask {
  name: string
  intervalMs: number
  lastRun: number | null
  nextRun: number
  enabled: boolean
  running: boolean
  lastResult?: { ok: boolean; message: string; timestamp: number }
}

const tasks: Map<string, ScheduledTask> = new Map()
let tickInterval: ReturnType<typeof setInterval> | null = null

/** Check if a setting is enabled (reads from settings table, falls back to default) */
async function isSettingEnabled(key: string, defaultValue: boolean): Promise<boolean> {
  try {
    const rows = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1)
    if (rows[0]) return rows[0].value === 'true'
    return defaultValue
  } catch {
    return defaultValue
  }
}

async function getSettingNumber(key: string, defaultValue: number): Promise<number> {
  try {
    const rows = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1)
    if (rows[0]) return parseInt(rows[0].value) || defaultValue
    return defaultValue
  } catch {
    return defaultValue
  }
}

/** Run a database backup — not applicable for Neon (cloud-managed backups) */
async function runBackup(): Promise<{ ok: boolean; message: string }> {
  // Neon Postgres is cloud-managed — backups are handled by Neon's built-in PITR.
  // No local backup needed.
  return { ok: true, message: 'Backup skipped — Neon manages backups automatically' }
}

/** Run data cleanup based on retention settings */
async function runCleanup(): Promise<{ ok: boolean; message: string }> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const ret = config.retention
    let totalDeleted = 0

    // Clean activities
    if (ret.activities > 0) {
      const cutoff = now - ret.activities * 86400
      const result = await db.delete(activities).where(lt(activities.created_at, cutoff))
      totalDeleted += (result as any).rowCount ?? 0
    }

    // Clean audit_log
    if (ret.auditLog > 0) {
      const { auditLog } = await import('@/db/schema')
      const cutoff = now - ret.auditLog * 86400
      const result = await db.delete(auditLog).where(lt(auditLog.created_at, cutoff))
      totalDeleted += (result as any).rowCount ?? 0
    }

    // Clean notifications
    if (ret.notifications > 0) {
      const cutoff = now - ret.notifications * 86400
      const result = await db.delete(notifications).where(lt(notifications.created_at, cutoff))
      totalDeleted += (result as any).rowCount ?? 0
    }

    // Clean pipeline_runs
    if (ret.pipelineRuns > 0) {
      const { pipelineRuns } = await import('@/db/schema')
      const cutoff = now - ret.pipelineRuns * 86400
      const result = await db.delete(pipelineRuns).where(lt(pipelineRuns.created_at, cutoff))
      totalDeleted += (result as any).rowCount ?? 0
    }

    if (totalDeleted > 0) {
      await logAuditEvent({
        action: 'auto_cleanup',
        actor: 'scheduler',
        detail: { total_deleted: totalDeleted },
      })
    }

    return { ok: true, message: `Cleaned ${totalDeleted} stale record${totalDeleted === 1 ? '' : 's'}` }
  } catch (err: any) {
    return { ok: false, message: `Cleanup failed: ${err.message}` }
  }
}

/** Check agent liveness - mark agents offline if not seen recently */
async function runHeartbeatCheck(): Promise<{ ok: boolean; message: string }> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const timeoutMinutes = await getSettingNumber('general.agent_timeout_minutes', 10)
    const threshold = now - timeoutMinutes * 60

    // Find agents that are not offline but haven't been seen recently
    const staleAgents = await db
      .select({ id: agents.id, name: agents.name, status: agents.status, last_seen: agents.last_seen })
      .from(agents)
      .where(
        and(
          ne(agents.status, 'offline'),
          or(isNull(agents.last_seen), lt(agents.last_seen, threshold))
        )
      )

    if (staleAgents.length === 0) {
      return { ok: true, message: 'All agents healthy' }
    }

    const names: string[] = []
    for (const agent of staleAgents) {
      await db.update(agents).set({ status: 'offline', updated_at: now }).where(eq(agents.id, agent.id))

      await db.insert(activities).values({
        type: 'agent_status_change',
        entity_type: 'agent',
        entity_id: agent.id,
        actor: 'heartbeat',
        description: `Agent "${agent.name}" marked offline (no heartbeat for ${timeoutMinutes}m)`,
        created_at: now,
      })

      names.push(agent.name)

      try {
        await db.insert(notifications).values({
          recipient: 'system',
          type: 'heartbeat',
          title: `Agent offline: ${agent.name}`,
          message: `Agent "${agent.name}" was marked offline after ${timeoutMinutes} minutes without heartbeat`,
          source_type: 'agent',
          source_id: agent.id,
          created_at: now,
        })
      } catch { /* notification creation failed */ }
    }

    await logAuditEvent({
      action: 'heartbeat_check',
      actor: 'scheduler',
      detail: { marked_offline: names },
    })

    return { ok: true, message: `Marked ${staleAgents.length} agent(s) offline: ${names.join(', ')}` }
  } catch (err: any) {
    return { ok: false, message: `Heartbeat check failed: ${err.message}` }
  }
}

const DAILY_MS = 24 * 60 * 60 * 1000
const FIVE_MINUTES_MS = 5 * 60 * 1000
const TICK_MS = 60 * 1000 // Check every minute

/** Initialize the scheduler */
export function initScheduler() {
  if (tickInterval) return // Already running

  // Auto-sync agents from openclaw.json on startup
  syncAgentsFromConfig('startup').catch(err => {
    logger.warn({ err }, 'Agent auto-sync failed')
  })

  // Register tasks
  const now = Date.now()
  const msUntilNextBackup = getNextDailyMs(3)
  const msUntilNextCleanup = getNextDailyMs(4)

  tasks.set('auto_backup', {
    name: 'Auto Backup',
    intervalMs: DAILY_MS,
    lastRun: null,
    nextRun: now + msUntilNextBackup,
    enabled: true,
    running: false,
  })

  tasks.set('auto_cleanup', {
    name: 'Auto Cleanup',
    intervalMs: DAILY_MS,
    lastRun: null,
    nextRun: now + msUntilNextCleanup,
    enabled: true,
    running: false,
  })

  tasks.set('agent_heartbeat', {
    name: 'Agent Heartbeat Check',
    intervalMs: FIVE_MINUTES_MS,
    lastRun: null,
    nextRun: now + FIVE_MINUTES_MS,
    enabled: true,
    running: false,
  })

  // Start the tick loop
  tickInterval = setInterval(tick, TICK_MS)
  logger.info('Scheduler initialized - cleanup at ~4AM, heartbeat every 5m')
}

/** Calculate ms until next occurrence of a given hour (UTC) */
function getNextDailyMs(hour: number): number {
  const now = new Date()
  const next = new Date(now)
  next.setUTCHours(hour, 0, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next.getTime() - now.getTime()
}

/** Check and run due tasks */
async function tick() {
  const now = Date.now()

  for (const [id, task] of tasks) {
    if (task.running || now < task.nextRun) continue

    const settingKey = id === 'auto_backup' ? 'general.auto_backup'
      : id === 'auto_cleanup' ? 'general.auto_cleanup'
      : 'general.agent_heartbeat'
    if (!(await isSettingEnabled(settingKey, id === 'agent_heartbeat'))) continue

    task.running = true
    try {
      const result = id === 'auto_backup' ? await runBackup()
        : id === 'agent_heartbeat' ? await runHeartbeatCheck()
        : await runCleanup()
      task.lastResult = { ...result, timestamp: now }
    } catch (err: any) {
      task.lastResult = { ok: false, message: err.message, timestamp: now }
    } finally {
      task.running = false
      task.lastRun = now
      task.nextRun = now + task.intervalMs
    }
  }
}

/** Get scheduler status (for API) */
export function getSchedulerStatus() {
  const result: Array<{
    id: string
    name: string
    enabled: boolean
    lastRun: number | null
    nextRun: number
    running: boolean
    lastResult?: { ok: boolean; message: string; timestamp: number }
  }> = []

  for (const [id, task] of tasks) {
    result.push({
      id,
      name: task.name,
      enabled: task.enabled,
      lastRun: task.lastRun,
      nextRun: task.nextRun,
      running: task.running,
      lastResult: task.lastResult,
    })
  }

  return result
}

/** Manually trigger a scheduled task */
export async function triggerTask(taskId: string): Promise<{ ok: boolean; message: string }> {
  if (taskId === 'auto_backup') return runBackup()
  if (taskId === 'auto_cleanup') return runCleanup()
  if (taskId === 'agent_heartbeat') return runHeartbeatCheck()
  return { ok: false, message: `Unknown task: ${taskId}` }
}

/** Stop the scheduler */
export function stopScheduler() {
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
}
