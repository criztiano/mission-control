import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { auditLog, tasks, activities, pipelineRuns, workflowPipelines } from '@/db/schema'
import { sql, and, SQL } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { heavyLimiter } from '@/lib/rate-limit'

/**
 * GET /api/export?type=audit|tasks|activities|pipelines&format=csv|json
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const format = searchParams.get('format') || 'csv'
  const since = searchParams.get('since')
  const until = searchParams.get('until')

  if (!type || !['audit', 'tasks', 'activities', 'pipelines'].includes(type)) {
    return NextResponse.json({ error: 'type required: audit, tasks, activities, pipelines' }, { status: 400 })
  }

  const requestedLimit = parseInt(searchParams.get('limit') || '10000')
  const maxLimit = 50000
  const limit = Math.min(requestedLimit, maxLimit)

  const conditions: string[] = []
  const params: any[] = []
  if (since) { conditions.push(`created_at >= ${parseInt(since)}`) }
  if (until) { conditions.push(`created_at <= ${parseInt(until)}`) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  let rows: any[] = []
  let headers: string[] = []
  let filename = ''

  switch (type) {
    case 'audit': {
      const result = await db.execute(sql`SELECT * FROM audit_log ${sql.raw(where)} ORDER BY created_at DESC LIMIT ${limit}`)
      rows = result.rows as any[]
      headers = ['id', 'action', 'actor', 'actor_id', 'target_type', 'target_id', 'detail', 'ip_address', 'user_agent', 'created_at']
      filename = 'audit-log'
      break
    }
    case 'tasks': {
      const result = await db.execute(sql`SELECT * FROM tasks ${sql.raw(where)} ORDER BY created_at DESC LIMIT ${limit}`)
      rows = result.rows as any[]
      headers = ['id', 'title', 'description', 'status', 'priority', 'assigned_to', 'creator', 'created_at', 'updated_at', 'tags']
      filename = 'tasks'
      break
    }
    case 'activities': {
      const result = await db.execute(sql`SELECT * FROM activities ${sql.raw(where)} ORDER BY created_at DESC LIMIT ${limit}`)
      rows = result.rows as any[]
      headers = ['id', 'type', 'entity_type', 'entity_id', 'actor', 'description', 'data', 'created_at']
      filename = 'activities'
      break
    }
    case 'pipelines': {
      const pipelineWhere = where.replace('created_at', 'pr.created_at')
      const result = await db.execute(sql`
        SELECT pr.*, wp.name as pipeline_name FROM pipeline_runs pr
        LEFT JOIN workflow_pipelines wp ON pr.pipeline_id = wp.id
        ${sql.raw(pipelineWhere)} ORDER BY pr.created_at DESC LIMIT ${limit}
      `)
      rows = result.rows as any[]
      headers = ['id', 'pipeline_id', 'pipeline_name', 'status', 'current_step', 'steps_snapshot', 'started_at', 'completed_at', 'triggered_by', 'created_at']
      filename = 'pipeline-runs'
      break
    }
  }

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  await logAuditEvent({
    action: 'data_export',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { type, format, row_count: rows.length },
    ip_address: ipAddress,
  })

  const dateStr = new Date().toISOString().split('T')[0]

  if (format === 'csv') {
    const csvRows = [headers.join(',')]
    for (const row of rows) {
      const values = headers.map(h => {
        const val = row[h]
        if (val == null) return ''
        const str = String(val)
        if (str.includes(',') || str.includes('\n') || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      })
      csvRows.push(values.join(','))
    }

    return new NextResponse(csvRows.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename=${filename}-${dateStr}.csv`,
      },
    })
  }

  return NextResponse.json(
    { type, exported_at: new Date().toISOString(), count: rows.length, data: rows },
    {
      headers: {
        'Content-Disposition': `attachment; filename=${filename}-${dateStr}.json`,
      },
    }
  )
}
