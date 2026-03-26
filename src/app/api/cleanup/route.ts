import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { activities, auditLog, notifications, pipelineRuns } from '@/db/schema'
import { sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { config } from '@/lib/config'
import { heavyLimiter } from '@/lib/rate-limit'

interface CleanupResult {
  table: string
  deleted: number
  cutoff_date: string
  retention_days: number
}

/**
 * GET /api/cleanup - Show retention policy and what would be cleaned
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const now = Math.floor(Date.now() / 1000)
  const preview = []

  for (const { table, days, label } of getRetentionTargets()) {
    if (days <= 0) {
      preview.push({ table: label, retention_days: 0, stale_count: 0, note: 'Retention disabled (keep forever)' })
      continue
    }
    const cutoff = now - days * 86400
    try {
      const rows = await db.execute(sql`SELECT COUNT(*) as c FROM ${sql.raw(table)} WHERE created_at < ${cutoff}`)
      preview.push({
        table: label,
        retention_days: days,
        cutoff_date: new Date(cutoff * 1000).toISOString().split('T')[0],
        stale_count: Number((rows.rows[0] as any)?.c || 0),
      })
    } catch {
      preview.push({ table: label, retention_days: days, stale_count: 0, note: 'Table not found' })
    }
  }

  // Token usage file stats
  const ret = config.retention
  try {
    const { readFile } = require('fs/promises')
    const data = JSON.parse(await readFile(config.tokensPath, 'utf-8'))
    const cutoffMs = Date.now() - ret.tokenUsage * 86400000
    const stale = data.filter((r: any) => r.timestamp < cutoffMs).length
    preview.push({
      table: 'Token Usage (file)',
      retention_days: ret.tokenUsage,
      cutoff_date: new Date(cutoffMs).toISOString().split('T')[0],
      stale_count: stale,
    })
  } catch {
    preview.push({ table: 'Token Usage (file)', retention_days: ret.tokenUsage, stale_count: 0, note: 'No token data file' })
  }

  return NextResponse.json({ retention: config.retention, preview })
}

/**
 * POST /api/cleanup - Run cleanup (admin only)
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  const body = await request.json().catch(() => ({}))
  const dryRun = body.dry_run === true

  const now = Math.floor(Date.now() / 1000)
  const results: CleanupResult[] = []
  let totalDeleted = 0

  for (const { table, days, label } of getRetentionTargets()) {
    if (days <= 0) continue
    const cutoff = now - days * 86400

    try {
      if (dryRun) {
        const rows = await db.execute(sql`SELECT COUNT(*) as c FROM ${sql.raw(table)} WHERE created_at < ${cutoff}`)
        const count = Number((rows.rows[0] as any)?.c || 0)
        results.push({ table: label, deleted: count, cutoff_date: new Date(cutoff * 1000).toISOString().split('T')[0], retention_days: days })
        totalDeleted += count
      } else {
        const rows = await db.execute(sql`DELETE FROM ${sql.raw(table)} WHERE created_at < ${cutoff} RETURNING id`)
        const count = (rows.rows as any[]).length
        results.push({ table: label, deleted: count, cutoff_date: new Date(cutoff * 1000).toISOString().split('T')[0], retention_days: days })
        totalDeleted += count
      }
    } catch {
      results.push({ table: label, deleted: 0, cutoff_date: '', retention_days: days })
    }
  }

  // Clean token usage file
  const ret = config.retention
  if (ret.tokenUsage > 0) {
    try {
      const { readFile, writeFile } = require('fs/promises')
      const raw = await readFile(config.tokensPath, 'utf-8')
      const data = JSON.parse(raw)
      const cutoffMs = Date.now() - ret.tokenUsage * 86400000
      const kept = data.filter((r: any) => r.timestamp >= cutoffMs)
      const removed = data.length - kept.length

      if (!dryRun && removed > 0) {
        await writeFile(config.tokensPath, JSON.stringify(kept, null, 2))
      }

      results.push({
        table: 'Token Usage (file)',
        deleted: removed,
        cutoff_date: new Date(cutoffMs).toISOString().split('T')[0],
        retention_days: ret.tokenUsage,
      })
      totalDeleted += removed
    } catch {
      // No token file or parse error
    }
  }

  if (!dryRun && totalDeleted > 0) {
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    await logAuditEvent({
      action: 'data_cleanup',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { total_deleted: totalDeleted, results },
      ip_address: ipAddress,
    })
  }

  return NextResponse.json({ dry_run: dryRun, total_deleted: totalDeleted, results })
}

function getRetentionTargets() {
  const ret = config.retention
  return [
    { table: 'activities', days: ret.activities, label: 'Activities' },
    { table: 'audit_log', days: ret.auditLog, label: 'Audit Log' },
    { table: 'notifications', days: ret.notifications, label: 'Notifications' },
    { table: 'pipeline_runs', days: ret.pipelineRuns, label: 'Pipeline Runs' },
  ]
}
