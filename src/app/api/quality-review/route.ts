import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { db_helpers } from '@/lib/db'
import { qualityReviews, tasks } from '@/db/schema'
import { eq, inArray, desc, sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { validateBody, qualityReviewSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const taskIdsParam = searchParams.get('taskIds')
    const taskId = parseInt(searchParams.get('taskId') || '')

    if (taskIdsParam) {
      const ids = taskIdsParam
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter((id) => !Number.isNaN(id))

      if (ids.length === 0) {
        return NextResponse.json({ error: 'taskIds must include at least one numeric id' }, { status: 400 })
      }

      const rows = await db.select().from(qualityReviews)
        .where(inArray(qualityReviews.task_id, ids))
        .orderBy(sql`task_id ASC, created_at DESC`)

      const byTask: Record<number, { status?: string; reviewer?: string; created_at?: number | null } | null> = {}
      for (const id of ids) byTask[id] = null

      for (const row of rows) {
        const existing = byTask[row.task_id]
        if (!existing || (row.created_at || 0) > (existing.created_at || 0)) {
          byTask[row.task_id] = { status: row.status, reviewer: row.reviewer, created_at: row.created_at }
        }
      }

      return NextResponse.json({ latest: byTask })
    }

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
    }

    const reviews = await db.select().from(qualityReviews)
      .where(eq(qualityReviews.task_id, taskId))
      .orderBy(desc(qualityReviews.created_at))
      .limit(10)

    return NextResponse.json({ reviews })
  } catch (error) {
    console.error('GET /api/quality-review error:', error)
    return NextResponse.json({ error: 'Failed to fetch quality reviews' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const validated = await validateBody(request, qualityReviewSchema)
    if ('error' in validated) return validated.error
    const { taskId, reviewer, status, notes } = validated.data

    const taskRows = await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(eq(tasks.id, taskId)).limit(1)
    const task = taskRows[0]
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const result = await db.insert(qualityReviews).values({
      task_id: taskId,
      reviewer,
      status,
      notes: notes || null,
    }).returning({ id: qualityReviews.id })

    await db_helpers.logActivity(
      'quality_review', 'task', taskId, reviewer,
      `Quality review ${status} for task: ${task.title}`,
      { status, notes }
    )

    return NextResponse.json({ success: true, id: result[0].id })
  } catch (error) {
    console.error('POST /api/quality-review error:', error)
    return NextResponse.json({ error: 'Failed to create quality review' }, { status: 500 })
  }
}
