import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireRole } from '@/lib/auth'
import { type CCPlan } from '@/lib/cc-db'
import { logger } from '@/lib/logger'
import { db } from '@/db/client'
import { plans, issues } from '@/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

/**
 * GET /api/plans — list plans
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const task_id = searchParams.get('task_id') || undefined
    const project_id = searchParams.get('project_id') || undefined
    const status = searchParams.get('status') || undefined
    const author = searchParams.get('author') || undefined

    let whereClause = sql`true`
    if (task_id) whereClause = sql`${whereClause} AND ${plans.task_id} = ${task_id}`
    if (project_id) whereClause = sql`${whereClause} AND ${plans.project_id} = ${project_id}`
    if (status) whereClause = sql`${whereClause} AND ${plans.status} = ${status}`
    if (author) whereClause = sql`${whereClause} AND ${plans.author} = ${author}`

    const planRows = await db.execute(sql`
      SELECT * FROM plans WHERE ${whereClause} ORDER BY created_at DESC
    `)

    return NextResponse.json({ plans: planRows.rows as unknown as CCPlan[] })
  } catch (err) {
    logger.error({ err }, 'GET /api/plans failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/plans — create a plan
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { title, content, task_id, project_id, author } = body

    if (!title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 })
    if (!content?.trim()) return NextResponse.json({ error: 'content is required' }, { status: 400 })
    if (!author?.trim()) return NextResponse.json({ error: 'author is required' }, { status: 400 })

    const id = randomUUID()
    const now = new Date().toISOString()

    await db.insert(plans).values({
      id,
      title: title.trim(),
      content: content.trim(),
      task_id: task_id || null,
      project_id: project_id || null,
      author: author.trim(),
      status: 'draft',
      responses: '{}',
      created_at: now,
      updated_at: now,
    })

    if (task_id) {
      await db.update(issues).set({ plan_id: id, updated_at: now }).where(eq(issues.id, task_id))
    }

    const planRows = await db.select().from(plans).where(eq(plans.id, id)).limit(1)
    const plan = planRows[0] as CCPlan

    logger.info({ planId: id, title, author }, 'Created plan')
    return NextResponse.json({ plan }, { status: 201 })
  } catch (err) {
    logger.error({ err }, 'POST /api/plans failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
