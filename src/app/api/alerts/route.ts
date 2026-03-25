import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { alertRules, notifications } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { createAlertSchema } from '@/lib/validation'

/**
 * GET /api/alerts - List all alert rules
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const rules = await db.select().from(alertRules).orderBy(sql`${alertRules.created_at} DESC`)
    return NextResponse.json({ rules })
  } catch {
    return NextResponse.json({ rules: [] })
  }
}

/**
 * POST /api/alerts - Create a new alert rule or evaluate rules
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let rawBody: any
  try { rawBody = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (rawBody.action === 'evaluate') {
    return evaluateRules()
  }

  const parseResult = createAlertSchema.safeParse(rawBody)
  if (!parseResult.success) {
    const messages = parseResult.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`)
    return NextResponse.json({ error: 'Validation failed', details: messages }, { status: 400 })
  }

  const { name, description, entity_type, condition_field, condition_operator, condition_value, action_type, action_config, cooldown_minutes } = parseResult.data

  try {
    const result = await db.insert(alertRules).values({
      name,
      description: description || null,
      entity_type,
      condition_field,
      condition_operator,
      condition_value,
      action_type: action_type || 'notification',
      action_config: JSON.stringify(action_config || {}),
      cooldown_minutes: cooldown_minutes || 60,
      created_by: auth.user?.username || 'system',
    }).returning({ id: alertRules.id })

    // Audit log
    try {
      await db.insert(sql`audit_log` as any).values({
        action: 'alert_rule_created',
        actor: auth.user?.username || 'system',
        detail: `Created alert rule: ${name}`
      })
    } catch { /* audit table might not exist */ }

    const ruleRows = await db.select().from(alertRules).where(eq(alertRules.id, result[0].id)).limit(1)
    return NextResponse.json({ rule: ruleRows[0] }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create rule' }, { status: 500 })
  }
}

/**
 * PUT /api/alerts - Update an alert rule
 */
export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const body = await request.json()
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const existingRows = await db.select().from(alertRules).where(eq(alertRules.id, id)).limit(1)
  if (!existingRows[0]) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

  const allowed = ['name', 'description', 'enabled', 'entity_type', 'condition_field', 'condition_operator', 'condition_value', 'action_type', 'action_config', 'cooldown_minutes']
  const updateData: any = { updated_at: Math.floor(Date.now() / 1000) }

  for (const key of allowed) {
    if (key in updates) {
      updateData[key] = key === 'action_config' ? JSON.stringify(updates[key]) : updates[key]
    }
  }

  if (Object.keys(updateData).length === 1) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })

  await db.update(alertRules).set(updateData).where(eq(alertRules.id, id))

  const updatedRows = await db.select().from(alertRules).where(eq(alertRules.id, id)).limit(1)
  return NextResponse.json({ rule: updatedRows[0] })
}

/**
 * DELETE /api/alerts - Delete an alert rule
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const body = await request.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  await db.delete(alertRules).where(eq(alertRules.id, id))

  try {
    await db.execute(sql`INSERT INTO audit_log (action, actor, detail) VALUES ('alert_rule_deleted', ${auth.user?.username || 'system'}, ${'Deleted alert rule #' + id})`)
  } catch { /* audit table might not exist */ }

  return NextResponse.json({ deleted: true })
}

/**
 * Evaluate all enabled alert rules
 */
async function evaluateRules() {
  let rules: any[]
  try {
    rules = await db.select().from(alertRules).where(eq(alertRules.enabled, true))
  } catch {
    return NextResponse.json({ evaluated: 0, triggered: 0, results: [] })
  }

  const now = Math.floor(Date.now() / 1000)
  const results: { rule_id: number; rule_name: string; triggered: boolean; reason?: string }[] = []

  for (const rule of rules) {
    if (rule.last_triggered_at && (now - rule.last_triggered_at) < rule.cooldown_minutes * 60) {
      results.push({ rule_id: rule.id, rule_name: rule.name, triggered: false, reason: 'In cooldown' })
      continue
    }

    const triggered = await evaluateRule(rule, now)
    results.push({ rule_id: rule.id, rule_name: rule.name, triggered, reason: triggered ? 'Condition met' : 'Condition not met' })

    if (triggered) {
      await db.update(alertRules).set({
        last_triggered_at: now,
        trigger_count: sql`${alertRules.trigger_count} + 1`
      }).where(eq(alertRules.id, rule.id))

      try {
        const config = JSON.parse(rule.action_config || '{}')
        const recipient = config.recipient || 'system'
        await db.insert(notifications).values({
          recipient,
          type: 'alert',
          title: `Alert: ${rule.name}`,
          message: rule.description || `Rule "${rule.name}" triggered`,
          source_type: 'alert_rule',
          source_id: rule.id,
        })
      } catch { /* notification creation failed */ }
    }
  }

  const triggered = results.filter(r => r.triggered).length
  return NextResponse.json({ evaluated: rules.length, triggered, results })
}

async function evaluateRule(rule: any, now: number): Promise<boolean> {
  try {
    switch (rule.entity_type) {
      case 'agent': return await evaluateAgentRule(rule, now)
      case 'task': return await evaluateTaskRule(rule)
      case 'session': return await evaluateSessionRule(rule)
      case 'activity': return await evaluateActivityRule(rule, now)
      default: return false
    }
  } catch {
    return false
  }
}

async function evaluateAgentRule(rule: any, now: number): Promise<boolean> {
  const { condition_field, condition_operator, condition_value } = rule

  if (condition_operator === 'age_minutes_above') {
    const threshold = now - parseInt(condition_value) * 60
    const rows = await db.execute(sql`
      SELECT COUNT(*) as c FROM agents WHERE status != 'offline' AND last_seen < ${threshold}
    `)
    return Number((rows.rows[0] as any)?.c || 0) > 0
  }

  const rows = await db.execute(sql`SELECT COUNT(*) as c FROM agents WHERE ${sql.raw(safeColumn('agents', condition_field))} = ${condition_value}`)
  const count = Number((rows.rows[0] as any)?.c || 0)
  if (condition_operator === 'count_above') return count > parseInt(condition_value)
  if (condition_operator === 'count_below') return count < parseInt(condition_value)
  return false
}

async function evaluateTaskRule(rule: any): Promise<boolean> {
  const { condition_field, condition_operator, condition_value } = rule

  const rows = await db.execute(sql`SELECT COUNT(*) as c FROM tasks WHERE ${sql.raw(safeColumn('tasks', condition_field))} = ${condition_value}`)
  const count = Number((rows.rows[0] as any)?.c || 0)
  if (condition_operator === 'count_above') return count > parseInt(condition_value)
  if (condition_operator === 'count_below') return count < parseInt(condition_value)
  return false
}

async function evaluateSessionRule(rule: any): Promise<boolean> {
  const { condition_operator, condition_value } = rule
  if (condition_operator === 'count_above') {
    const rows = await db.execute(sql`SELECT COUNT(*) as c FROM agents WHERE status = 'busy'`)
    return Number((rows.rows[0] as any)?.c || 0) > parseInt(condition_value)
  }
  return false
}

async function evaluateActivityRule(rule: any, now: number): Promise<boolean> {
  const { condition_field, condition_operator, condition_value } = rule
  if (condition_operator === 'count_above') {
    const hourAgo = now - 3600
    const rows = await db.execute(sql`SELECT COUNT(*) as c FROM activities WHERE created_at > ${hourAgo} AND ${sql.raw(safeColumn('activities', condition_field))} = ${condition_value}`)
    return Number((rows.rows[0] as any)?.c || 0) > parseInt(condition_value)
  }
  return false
}

const SAFE_COLUMNS: Record<string, Set<string>> = {
  agents: new Set(['status', 'role', 'name', 'last_seen', 'last_activity']),
  tasks: new Set(['status', 'priority', 'assigned_to', 'title']),
  activities: new Set(['type', 'actor', 'entity_type']),
}

function safeColumn(table: string, column: string): string {
  if (SAFE_COLUMNS[table]?.has(column)) return column
  return 'id'
}
