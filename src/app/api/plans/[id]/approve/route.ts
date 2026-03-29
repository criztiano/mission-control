import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { type CCPlan, getIssue, createTurn } from '@/lib/cc-db'
import { dispatchTaskNudge } from '@/lib/task-dispatch'
import { logger } from '@/lib/logger'
import { db } from '@/db/client'
import { plans } from '@/db/schema'
import { eq } from 'drizzle-orm'

/**
 * POST /api/plans/:id/approve — approve or request revision on a plan
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await request.json()
    const { action, comment } = body

    if (!action || !['approve', 'revise'].includes(action)) {
      return NextResponse.json({ error: 'action must be "approve" or "revise"' }, { status: 400 })
    }

    const planRows = await db.select().from(plans).where(eq(plans.id, id)).limit(1)
    const plan = planRows[0] as CCPlan | undefined
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const newStatus = action === 'approve' ? 'approved' : 'rejected'
    const now = new Date().toISOString()

    await db.update(plans).set({ status: newStatus, updated_at: now }).where(eq(plans.id, id))

    if (plan.task_id) {
      const issue = await getIssue(plan.task_id)
      if (issue) {
        const user = auth.user?.username || 'cri'
        const turnContent = action === 'approve'
          ? `✅ Plan approved${comment ? `: ${comment}` : ''}. Proceed with implementation.`
          : `🔄 Revision requested${comment ? `: ${comment}` : ''}. Please update the plan.`

        await createTurn(plan.task_id, {
          type: 'result',
          author: user,
          content: turnContent,
          assigned_to: plan.author,
          links: [],
        })

        logger.info({ planId: id, taskId: plan.task_id, action, author: plan.author }, 'Plan decision posted as turn')

        // Dispatch the task to the plan author (e.g. Piem gets dispatched after approval)
        try {
          await dispatchTaskNudge({
            taskId: plan.task_id,
            title: issue.title,
            assignee: plan.author,
            reason: 'reassign',
            content: turnContent,
          });
        } catch (e) {
          logger.warn({ err: e, taskId: plan.task_id }, 'dispatch after plan decision failed')
        }
      }
    }

    logger.info({ planId: id, action, newStatus }, 'Plan status updated')
    return NextResponse.json({ success: true, status: newStatus })
  } catch (err) {
    logger.error({ err }, 'POST /api/plans/:id/approve failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
