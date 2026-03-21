import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getCCDatabase, getCCDatabaseWrite, type CCPlan } from '@/lib/cc-db'
import { logger } from '@/lib/logger'

/**
 * GET /api/plans/:id — get a single plan with parsed responses
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const db = getCCDatabase()
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as CCPlan | undefined

    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    let responses: Record<string, unknown> = {}
    try { responses = JSON.parse(plan.responses || '{}') } catch {}

    return NextResponse.json({ plan: { ...plan, responses } })
  } catch (err) {
    logger.error({ err }, 'GET /api/plans/:id failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/plans/:id — update plan fields
 * Body: { title?, content?, status?, task_id?, project_id? }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await request.json()
    const { title, content, status, task_id, project_id } = body

    const db = getCCDatabaseWrite()
    try {
      const existing = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as CCPlan | undefined
      if (!existing) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

      const updates: string[] = []
      const values: unknown[] = []

      if (title !== undefined) { updates.push('title = ?'); values.push(title) }
      if (content !== undefined) { updates.push('content = ?'); values.push(content) }
      if (status !== undefined) { updates.push('status = ?'); values.push(status) }
      if (task_id !== undefined) { updates.push('task_id = ?'); values.push(task_id || null) }
      if (project_id !== undefined) { updates.push('project_id = ?'); values.push(project_id || null) }

      if (updates.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

      const now = new Date().toISOString()
      updates.push('updated_at = ?')
      values.push(now)
      values.push(id)

      db.prepare(`UPDATE plans SET ${updates.join(', ')} WHERE id = ?`).run(...values)

      // If task_id changed, update issues
      if (task_id !== undefined) {
        // Clear old link
        if (existing.task_id) {
          db.prepare('UPDATE issues SET plan_id = NULL, updated_at = ? WHERE id = ? AND plan_id = ?')
            .run(now, existing.task_id, id)
        }
        // Set new link
        if (task_id) {
          db.prepare('UPDATE issues SET plan_id = ?, updated_at = ? WHERE id = ?')
            .run(id, now, task_id)
        }
      }

      const updated = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as CCPlan
      let responses: Record<string, unknown> = {}
      try { responses = JSON.parse(updated.responses || '{}') } catch {}

      logger.info({ planId: id }, 'Updated plan')
      return NextResponse.json({ plan: { ...updated, responses } })
    } finally {
      db.close()
    }
  } catch (err) {
    logger.error({ err }, 'PUT /api/plans/:id failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/plans/:id — delete a plan and clear any linked issue's plan_id
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const db = getCCDatabaseWrite()
    try {
      const existing = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as CCPlan | undefined
      if (!existing) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

      const now = new Date().toISOString()

      // Clear linked issue's plan_id
      if (existing.task_id) {
        db.prepare('UPDATE issues SET plan_id = NULL, updated_at = ? WHERE id = ? AND plan_id = ?')
          .run(now, existing.task_id, id)
      }

      db.prepare('DELETE FROM plans WHERE id = ?').run(id)

      logger.info({ planId: id }, 'Deleted plan')
      return NextResponse.json({ success: true })
    } finally {
      db.close()
    }
  } catch (err) {
    logger.error({ err }, 'DELETE /api/plans/:id failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
