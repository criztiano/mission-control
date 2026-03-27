import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { auditLog } from '@/db/schema'
import { eq, and, sql, SQL } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'

function safeParseJson(str: string): any {
  try { return JSON.parse(str) } catch { return str }
}

/**
 * GET /api/audit - Query audit log (admin only)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')
  const actor = searchParams.get('actor')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500)
  const offset = parseInt(searchParams.get('offset') || '0')
  const since = searchParams.get('since')
  const until = searchParams.get('until')

  const conditions: SQL[] = []
  if (action) conditions.push(eq(auditLog.action, action))
  if (actor) conditions.push(eq(auditLog.actor, actor))
  if (since) conditions.push(sql`${auditLog.created_at} >= ${parseInt(since)}`)
  if (until) conditions.push(sql`${auditLog.created_at} <= ${parseInt(until)}`)

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Parallelize count + rows (independent queries)
  const [countRows, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(auditLog).where(whereClause),
    db.select().from(auditLog).where(whereClause)
      .orderBy(sql`${auditLog.created_at} DESC`)
      .limit(limit)
      .offset(offset),
  ])
  const total = countRows[0]?.count ?? 0

  return NextResponse.json({
    events: rows.map((row) => ({
      ...row,
      detail: row.detail ? safeParseJson(row.detail) : null,
    })),
    total,
    limit,
    offset,
  })
}
