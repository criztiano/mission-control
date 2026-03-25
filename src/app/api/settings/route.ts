import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { db } from '@/db/client'
import { settings } from '@/db/schema'
import { eq, asc } from 'drizzle-orm'
import { config } from '@/lib/config'
import { mutationLimiter } from '@/lib/rate-limit'
import { validateBody, updateSettingsSchema } from '@/lib/validation'

// Default settings definitions (category, description, default value)
const settingDefinitions: Record<string, { category: string; description: string; default: string }> = {
  // Retention
  'retention.activities_days': { category: 'retention', description: 'Days to keep activity records', default: String(config.retention.activities) },
  'retention.audit_log_days': { category: 'retention', description: 'Days to keep audit log entries', default: String(config.retention.auditLog) },
  'retention.logs_days': { category: 'retention', description: 'Days to keep log files', default: String(config.retention.logs) },
  'retention.notifications_days': { category: 'retention', description: 'Days to keep notifications', default: String(config.retention.notifications) },
  'retention.pipeline_runs_days': { category: 'retention', description: 'Days to keep pipeline run history', default: String(config.retention.pipelineRuns) },
  'retention.token_usage_days': { category: 'retention', description: 'Days to keep token usage data', default: String(config.retention.tokenUsage) },

  // Gateway
  'gateway.host': { category: 'gateway', description: 'Gateway hostname', default: config.gatewayHost },
  'gateway.port': { category: 'gateway', description: 'Gateway port number', default: String(config.gatewayPort) },

  // General
  'general.site_name': { category: 'general', description: 'Eden display name', default: 'Eden' },
  'general.auto_cleanup': { category: 'general', description: 'Enable automatic data cleanup', default: 'false' },
  'general.auto_backup': { category: 'general', description: 'Enable automatic daily backups', default: 'false' },
  'general.backup_retention_count': { category: 'general', description: 'Number of backup files to keep', default: '10' },
}

/**
 * GET /api/settings - List all settings (grouped by category)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rows = await db.select().from(settings).orderBy(asc(settings.category), asc(settings.key))
  const stored = new Map(rows.map(r => [r.key, r]))

  // Merge defaults with stored values
  const result: Array<{
    key: string
    value: string
    description: string
    category: string
    updated_by: string | null
    updated_at: number | null
    is_default: boolean
  }> = []

  for (const [key, def] of Object.entries(settingDefinitions)) {
    const row = stored.get(key)
    result.push({
      key,
      value: row?.value ?? def.default,
      description: row?.description ?? def.description,
      category: row?.category ?? def.category,
      updated_by: row?.updated_by ?? null,
      updated_at: row?.updated_at ?? null,
      is_default: !row,
    })
  }

  // Also include any custom settings not in definitions
  for (const row of rows) {
    if (!settingDefinitions[row.key]) {
      result.push({
        key: row.key,
        value: row.value,
        description: row.description ?? '',
        category: row.category,
        updated_by: row.updated_by ?? null,
        updated_at: row.updated_at ?? null,
        is_default: false,
      })
    }
  }

  // Group by category
  const grouped: Record<string, typeof result> = {}
  for (const s of result) {
    if (!grouped[s.category]) grouped[s.category] = []
    grouped[s.category].push(s)
  }

  return NextResponse.json({ settings: result, grouped })
}

/**
 * PUT /api/settings - Update one or more settings
 * Body: { settings: { key: value, ... } }
 */
export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const validResult = await validateBody(request, updateSettingsSchema)
  if ('error' in validResult) return validResult.error
  const body = validResult.data

  const updated: string[] = []
  const changes: Record<string, { old: string | null; new: string }> = {}

  for (const [key, value] of Object.entries(body.settings)) {
    const strValue = String(value)
    const def = settingDefinitions[key]
    const category = def?.category ?? 'custom'
    const description = def?.description ?? null

    // Get old value for audit
    const existing = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1)
    changes[key] = { old: existing[0]?.value ?? null, new: strValue }

    await db.insert(settings).values({
      key,
      value: strValue,
      description,
      category,
      updated_by: auth.user.username,
      updated_at: Math.floor(Date.now() / 1000),
    }).onConflictDoUpdate({
      target: settings.key,
      set: {
        value: strValue,
        updated_by: auth.user.username,
        updated_at: Math.floor(Date.now() / 1000),
      },
    })
    updated.push(key)
  }

  // Audit log
  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  await logAuditEvent({
    action: 'settings_update',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { updated_keys: updated, changes },
    ip_address: ipAddress,
  })

  return NextResponse.json({ updated, count: updated.length })
}

/**
 * DELETE /api/settings?key=... - Reset a setting to default
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
  const key = body.key

  if (!key) {
    return NextResponse.json({ error: 'key parameter required' }, { status: 400 })
  }

  const existing = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1)

  if (!existing.length) {
    return NextResponse.json({ error: 'Setting not found or already at default' }, { status: 404 })
  }

  await db.delete(settings).where(eq(settings.key, key))

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  await logAuditEvent({
    action: 'settings_reset',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { key, old_value: existing[0].value },
    ip_address: ipAddress,
  })

  return NextResponse.json({ reset: key, default_value: settingDefinitions[key]?.default ?? null })
}
