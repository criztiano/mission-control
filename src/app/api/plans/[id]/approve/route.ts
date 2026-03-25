import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getCCDatabase, getCCDatabaseWrite, type CCPlan, getIssue, createTurn } from '@/lib/cc-db'
import { logger } from '@/lib/logger'

/**
 * POST /api/plans/:id/approve — approve or request revision on a plan
 * Body: { action: 'approve' | 'revise', comment?: string }
 *
 * - Updates plan status to 'approved' or 'rejected'
 * - If plan is linked to a task, posts a turn and reassigns to the plan author (PM)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await request.json()
    const { action, comment } = body

    if (!action || !['approve', 'revise'].includes(action)) {
      return NextResponse.json({ error: 'action must be "approve" or "revise"' }, { status: 400 })
    }

    const readDb = getCCDatabase()
    const plan = readDb.prepare('SELECT * FROM plans WHERE id = ?').get(id) as CCPlan | undefined
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const newStatus = action === 'approve' ? 'approved' : 'rejected'
    const now = new Date().toISOString()

    const db = getCCDatabaseWrite()
    try {
      db.prepare('UPDATE plans SET status = ?, updated_at = ? WHERE id = ?')
        .run(newStatus, now, id)

      // If linked to a task, post a turn and reassign to the plan author
      if (plan.task_id) {
        const issue = getIssue(plan.task_id)
        if (issue) {
          const user = auth.user?.username || 'cri'
          const turnContent = action === 'approve'
            ? `✅ Plan approved${comment ? `: ${comment}` : ''}. Proceed with implementation.`
            : `🔄 Revision requested${comment ? `: ${comment}` : ''}. Please update the plan.`

          createTurn(plan.task_id, {
            type: 'result',
            author: user,
            content: turnContent,
            assigned_to: plan.author, // Back to the PM
            links: [],
          })

          logger.info({ planId: id, taskId: plan.task_id, action, author: plan.author }, 'Plan decision posted as turn')
        }
      }

      logger.info({ planId: id, action, newStatus }, 'Plan status updated')
      return NextResponse.json({ success: true, status: newStatus })
    } finally {
      db.close()
    }
  } catch (err) {
    logger.error({ err }, 'POST /api/plans/:id/approve failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
