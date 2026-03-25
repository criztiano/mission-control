import { NextRequest, NextResponse } from 'next/server'
import net from 'node:net'
import { statSync } from 'node:fs'
import { runCommand, runOpenClaw, runClawdbot } from '@/lib/command'
import { config } from '@/lib/config'
import { db } from '@/db/client'
import { agents, tasks, activities, auditLog, notifications, pipelineRuns, webhooks } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getAllGatewaySessions, getAgentLiveStatuses } from '@/lib/sessions'
import { requireRole } from '@/lib/auth'
import { MODEL_CATALOG } from '@/lib/models'

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'overview'

    if (action === 'overview') {
      const status = await getSystemStatus()
      return NextResponse.json(status)
    }

    if (action === 'dashboard') {
      const data = await getDashboardData()
      return NextResponse.json(data)
    }

    if (action === 'gateway') {
      const gatewayStatus = await getGatewayStatus()
      return NextResponse.json(gatewayStatus)
    }

    if (action === 'models') {
      const models = await getAvailableModels()
      return NextResponse.json({ models })
    }

    if (action === 'health') {
      const health = await performHealthCheck()
      return NextResponse.json(health)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Status API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function getDashboardData() {
  const [system, dbStats] = await Promise.all([getSystemStatus(), getDbStats()])
  return { ...system, db: dbStats }
}

async function getDbStats() {
  try {
    const now = Math.floor(Date.now() / 1000)
    const day = now - 86400
    const week = now - 7 * 86400

    // Task breakdown
    const taskStatsRows = await db.execute(sql`SELECT status, COUNT(*) as count FROM tasks GROUP BY status`)
    const tasksByStatus: Record<string, number> = {}
    let totalTasks = 0
    for (const row of taskStatsRows.rows as any[]) {
      tasksByStatus[row.status] = Number(row.count)
      totalTasks += Number(row.count)
    }

    // Agent breakdown
    const agentStatsRows = await db.execute(sql`SELECT status, COUNT(*) as count FROM agents GROUP BY status`)
    const agentsByStatus: Record<string, number> = {}
    let totalAgents = 0
    for (const row of agentStatsRows.rows as any[]) {
      agentsByStatus[row.status] = Number(row.count)
      totalAgents += Number(row.count)
    }

    // Audit events
    const auditDayRows = await db.execute(sql`SELECT COUNT(*) as c FROM audit_log WHERE created_at > ${day}`)
    const auditWeekRows = await db.execute(sql`SELECT COUNT(*) as c FROM audit_log WHERE created_at > ${week}`)
    const loginFailRows = await db.execute(sql`SELECT COUNT(*) as c FROM audit_log WHERE action = 'login_failed' AND created_at > ${day}`)

    // Activities (24h)
    const activityDayRows = await db.execute(sql`SELECT COUNT(*) as c FROM activities WHERE created_at > ${day}`)

    // Notifications (unread)
    const unreadNotifsRows = await db.execute(sql`SELECT COUNT(*) as c FROM notifications WHERE read_at IS NULL`)

    // Pipeline runs
    let pipelineActive = 0
    let pipelineRecent = 0
    try {
      const paRows = await db.execute(sql`SELECT COUNT(*) as c FROM pipeline_runs WHERE status = 'running'`)
      const prRows = await db.execute(sql`SELECT COUNT(*) as c FROM pipeline_runs WHERE created_at > ${day}`)
      pipelineActive = Number((paRows.rows[0] as any)?.c || 0)
      pipelineRecent = Number((prRows.rows[0] as any)?.c || 0)
    } catch {}

    // Latest backup
    let latestBackup: { name: string; size: number; age_hours: number } | null = null
    try {
      const { readdirSync } = require('fs')
      const { join, dirname } = require('path')
      const backupDir = join(dirname(config.dbPath), 'backups')
      const files = readdirSync(backupDir)
        .filter((f: string) => f.endsWith('.db'))
        .map((f: string) => {
          const stat = statSync(join(backupDir, f))
          return { name: f, size: stat.size, mtime: stat.mtimeMs }
        })
        .sort((a: any, b: any) => b.mtime - a.mtime)
      if (files.length > 0) {
        latestBackup = { name: files[0].name, size: files[0].size, age_hours: Math.round((Date.now() - files[0].mtime) / 3600000) }
      }
    } catch {}

    let dbSizeBytes = 0
    try { dbSizeBytes = statSync(config.dbPath).size } catch {}

    let webhookCount = 0
    try {
      const wRows = await db.execute(sql`SELECT COUNT(*) as c FROM webhooks`)
      webhookCount = Number((wRows.rows[0] as any)?.c || 0)
    } catch {}

    return {
      tasks: { total: totalTasks, byStatus: tasksByStatus },
      agents: { total: totalAgents, byStatus: agentsByStatus },
      audit: {
        day: Number((auditDayRows.rows[0] as any)?.c || 0),
        week: Number((auditWeekRows.rows[0] as any)?.c || 0),
        loginFailures: Number((loginFailRows.rows[0] as any)?.c || 0),
      },
      activities: { day: Number((activityDayRows.rows[0] as any)?.c || 0) },
      notifications: { unread: Number((unreadNotifsRows.rows[0] as any)?.c || 0) },
      pipelines: { active: pipelineActive, recentDay: pipelineRecent },
      backup: latestBackup,
      dbSizeBytes,
      webhookCount,
    }
  } catch (err) {
    console.error('getDbStats error:', err)
    return null
  }
}

async function getSystemStatus() {
  const status: any = {
    timestamp: Date.now(),
    uptime: 0,
    memory: { total: 0, used: 0, available: 0 },
    disk: { total: 0, used: 0, available: 0 },
    sessions: { total: 0, active: 0 },
    processes: []
  }

  try {
    const { stdout: uptimeOutput } = await runCommand('uptime', ['-s'], { timeoutMs: 3000 })
    const bootTime = new Date(uptimeOutput.trim())
    status.uptime = Date.now() - bootTime.getTime()
  } catch (error) {}

  try {
    const { stdout: memOutput } = await runCommand('free', ['-m'], { timeoutMs: 3000 })
    const memLines = memOutput.split('\n')
    const memLine = memLines.find(line => line.startsWith('Mem:'))
    if (memLine) {
      const parts = memLine.split(/\s+/)
      status.memory = { total: parseInt(parts[1]) || 0, used: parseInt(parts[2]) || 0, available: parseInt(parts[6]) || 0 }
    }
  } catch (error) {}

  try {
    const { stdout: diskOutput } = await runCommand('df', ['-h', '/'], { timeoutMs: 3000 })
    const lastLine = diskOutput.trim().split('\n').pop() || ''
    const diskParts = lastLine.split(/\s+/)
    if (diskParts.length >= 4) {
      status.disk = { total: diskParts[1], used: diskParts[2], available: diskParts[3], usage: diskParts[4] }
    }
  } catch (error) {}

  try {
    const { stdout: processOutput } = await runCommand('ps', ['-A', '-o', 'pid,comm,args'], { timeoutMs: 3000 })
    status.processes = processOutput.split('\n')
      .filter(line => line.trim())
      .filter(line => !line.trim().toLowerCase().startsWith('pid '))
      .map(line => {
        const parts = line.trim().split(/\s+/)
        return { pid: parts[0], command: parts.slice(2).join(' ') }
      })
      .filter((proc) => /clawdbot|openclaw/i.test(proc.command))
  } catch (error) {}

  try {
    const gatewaySessions = getAllGatewaySessions()
    status.sessions = { total: gatewaySessions.length, active: gatewaySessions.filter((s) => s.active).length }

    try {
      const liveStatuses = getAgentLiveStatuses()
      const now = Math.floor(Date.now() / 1000)
      for (const [agentName, info] of liveStatuses) {
        await db.execute(sql`
          UPDATE agents SET status = ${info.status}, last_seen = ${Math.floor(info.lastActivity / 1000)}, updated_at = ${now}
          WHERE LOWER(name) = LOWER(${agentName})
            OR LOWER(REPLACE(name, ' ', '-')) = LOWER(${agentName})
        `)
      }
    } catch (dbErr) {
      console.error('Error syncing agent statuses:', dbErr)
    }
  } catch (error) {}

  return status
}

async function getGatewayStatus() {
  const gatewayStatus: any = {
    running: false,
    port: config.gatewayPort,
    pid: null,
    uptime: 0,
    version: null,
    connections: 0
  }

  try {
    const { stdout } = await runCommand('ps', ['-A', '-o', 'pid,comm,args'], { timeoutMs: 3000 })
    const match = stdout.split('\n').find((line) => /clawdbot-gateway|openclaw-gateway|openclaw.*gateway/i.test(line))
    if (match) {
      const parts = match.trim().split(/\s+/)
      gatewayStatus.running = true
      gatewayStatus.pid = parts[0]
    }
  } catch (error) {}

  try {
    gatewayStatus.port_listening = await isPortOpen(config.gatewayHost, config.gatewayPort)
  } catch (error) {}

  try {
    const { stdout } = await runOpenClaw(['--version'], { timeoutMs: 3000 })
    gatewayStatus.version = stdout.trim()
  } catch (error) {
    try {
      const { stdout } = await runClawdbot(['--version'], { timeoutMs: 3000 })
      gatewayStatus.version = stdout.trim()
    } catch (innerError) {
      gatewayStatus.version = 'unknown'
    }
  }

  return gatewayStatus
}

async function getAvailableModels() {
  const models = [...MODEL_CATALOG]

  try {
    const { stdout: ollamaOutput } = await runCommand('ollama', ['list'], { timeoutMs: 5000 })
    const ollamaModels = ollamaOutput.split('\n')
      .slice(1)
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(/\s+/)
        return { alias: parts[0], name: `ollama/${parts[0]}`, provider: 'ollama', description: 'Local model', costPer1k: 0.0, size: parts[1] || 'unknown' }
      })

    ollamaModels.forEach(model => {
      if (!models.find(m => m.name === model.name)) models.push(model)
    })
  } catch (error) {}

  return models
}

async function performHealthCheck() {
  const health: any = { overall: 'healthy', checks: [], timestamp: Date.now() }

  try {
    const gatewayStatus = await getGatewayStatus()
    health.checks.push({ name: 'Gateway', status: gatewayStatus.running ? 'healthy' : 'unhealthy', message: gatewayStatus.running ? 'Gateway is running' : 'Gateway is not running' })
  } catch (error) {
    health.checks.push({ name: 'Gateway', status: 'error', message: 'Failed to check gateway status' })
  }

  try {
    const { stdout } = await runCommand('df', ['/', '--output=pcent'], { timeoutMs: 3000 })
    const lines = stdout.trim().split('\n')
    const last = lines[lines.length - 1] || ''
    const usagePercent = parseInt(last.replace('%', '').trim() || '0')
    health.checks.push({ name: 'Disk Space', status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical', message: `Disk usage: ${usagePercent}%` })
  } catch (error) {
    health.checks.push({ name: 'Disk Space', status: 'error', message: 'Failed to check disk space' })
  }

  try {
    const { stdout } = await runCommand('free', ['-m'], { timeoutMs: 3000 })
    const lines = stdout.split('\n')
    const memLine = lines.find((line) => line.startsWith('Mem:'))
    const parts = (memLine || '').split(/\s+/)
    const total = parseInt(parts[1] || '0')
    const available = parseInt(parts[6] || '0')
    const usagePercent = Math.round(((total - available) / total) * 100)
    health.checks.push({ name: 'Memory Usage', status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical', message: `Memory usage: ${usagePercent}%` })
  } catch (error) {
    health.checks.push({ name: 'Memory Usage', status: 'error', message: 'Failed to check memory usage' })
  }

  const hasError = health.checks.some((check: any) => check.status === 'error')
  const hasCritical = health.checks.some((check: any) => check.status === 'critical')
  const hasWarning = health.checks.some((check: any) => check.status === 'warning')

  if (hasError || hasCritical) health.overall = 'unhealthy'
  else if (hasWarning) health.overall = 'warning'

  return health
}

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const cleanup = () => { socket.removeAllListeners(); socket.destroy() }
    socket.setTimeout(1500)
    socket.once('connect', () => { cleanup(); resolve(true) })
    socket.once('timeout', () => { cleanup(); resolve(false) })
    socket.once('error', () => { cleanup(); resolve(false) })
    socket.connect(port, host)
  })
}
