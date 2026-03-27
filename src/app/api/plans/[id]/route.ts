import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { type CCPlan } from '@/lib/cc-db'
import { logger } from '@/lib/logger'
import { db } from '@/db/client'
import { plans, issues } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

/**
 * GET /api/plans/:id — get a single plan with parsed responses
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const rows = await db.select().from(plans).where(eq(plans.id, id)).limit(1)
    const plan = rows[0] as CCPlan | undefined

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
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await request.json()
    const { title, content, status, task_id, project_id } = body

    const existingRows = await db.select().from(plans).where(eq(plans.id, id)).limit(1)
    const existing = existingRows[0] as CCPlan | undefined
    if (!existing) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const updateFields: Record<string, any> = {}
    if (title !== undefined) updateFields.title = title
    if (content !== undefined) updateFields.content = content
    if (status !== undefined) updateFields.status = status
    if (task_id !== undefined) updateFields.task_id = task_id || null
    if (project_id !== undefined) updateFields.project_id = project_id || null

    if (Object.keys(updateFields).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

    const now = new Date().toISOString()
    updateFields.updated_at = now

    const updatedRows = await db.update(plans).set(updateFields).where(eq(plans.id, id)).returning()

    // If task_id changed, update issues
    if (task_id !== undefined) {
      if (existing.task_id) {
        await db.update(issues).set({ plan_id: null, updated_at: now }).where(and(eq(issues.id, existing.task_id), eq(issues.plan_id, id)))
      }
      if (task_id) {
        await db.update(issues).set({ plan_id: id, updated_at: now }).where(eq(issues.id, task_id))
      }
    }

    const updated = updatedRows[0] as CCPlan
    let responses: Record<string, unknown> = {}
    try { responses = JSON.parse(updated.responses || '{}') } catch {}

    logger.info({ planId: id }, 'Updated plan')
    return NextResponse.json({ plan: { ...updated, responses } })
  } catch (err) {
    logger.error({ err }, 'PUT /api/plans/:id failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/plans/:id — delete a plan
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const existingRows = await db.select().from(plans).where(eq(plans.id, id)).limit(1)
    const existing = existingRows[0] as CCPlan | undefined
    if (!existing) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const now = new Date().toISOString()

    if (existing.task_id) {
      await db.update(issues).set({ plan_id: null, updated_at: now }).where(and(eq(issues.id, existing.task_id), eq(issues.plan_id, id)))
    }

    await db.delete(plans).where(eq(plans.id, id))

    logger.info({ planId: id }, 'Deleted plan')
    return NextResponse.json({ success: true })
  } catch (err) {
    logger.error({ err }, 'DELETE /api/plans/:id failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
