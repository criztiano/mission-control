import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireRole } from '@/lib/auth'
import { getCCDatabase, getCCDatabaseWrite, type CCPlan } from '@/lib/cc-db'
import { logger } from '@/lib/logger'

/**
 * GET /api/plans — list plans
 * Query params: task_id, project_id, status, author
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const task_id = searchParams.get('task_id') || undefined
    const project_id = searchParams.get('project_id') || undefined
    const status = searchParams.get('status') || undefined
    const author = searchParams.get('author') || undefined

    const db = getCCDatabase()
    const conditions: string[] = []
    const params: string[] = []

    if (task_id) { conditions.push('task_id = ?'); params.push(task_id) }
    if (project_id) { conditions.push('project_id = ?'); params.push(project_id) }
    if (status) { conditions.push('status = ?'); params.push(status) }
    if (author) { conditions.push('author = ?'); params.push(author) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const plans = db.prepare(`SELECT * FROM plans ${where} ORDER BY created_at DESC`).all(...params) as CCPlan[]

    return NextResponse.json({ plans })
  } catch (err) {
    logger.error({ err }, 'GET /api/plans failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/plans — create a plan
 * Body: { title, content, task_id?, project_id?, author }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { title, content, task_id, project_id, author } = body

    if (!title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 })
    if (!content?.trim()) return NextResponse.json({ error: 'content is required' }, { status: 400 })
    if (!author?.trim()) return NextResponse.json({ error: 'author is required' }, { status: 400 })

    const id = randomUUID()
    const now = new Date().toISOString()

    const db = getCCDatabaseWrite()
    try {
      db.prepare(`
        INSERT INTO plans (id, title, content, task_id, project_id, author, status, responses, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', '{}', ?, ?)
      `).run(id, title.trim(), content.trim(), task_id || null, project_id || null, author.trim(), now, now)

      // If task_id provided, update the issue's plan_id
      if (task_id) {
        db.prepare('UPDATE issues SET plan_id = ?, updated_at = ? WHERE id = ?')
          .run(id, now, task_id)
      }

      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as CCPlan

      logger.info({ planId: id, title, author }, 'Created plan')
      return NextResponse.json({ plan }, { status: 201 })
    } finally {
      db.close()
    }
  } catch (err) {
    logger.error({ err }, 'POST /api/plans failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
