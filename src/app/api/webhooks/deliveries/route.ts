import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { webhookDeliveries, webhooks } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'

/**
 * GET /api/webhooks/deliveries - Get delivery history for a webhook
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const webhookId = searchParams.get('webhook_id')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')

    let deliveriesRows
    let totalRows

    if (webhookId) {
      deliveriesRows = await db.execute(sql`
        SELECT wd.*, w.name as webhook_name, w.url as webhook_url
        FROM webhook_deliveries wd
        JOIN webhooks w ON wd.webhook_id = w.id
        WHERE wd.webhook_id = ${parseInt(webhookId)}
        ORDER BY wd.created_at DESC LIMIT ${limit} OFFSET ${offset}
      `)
      totalRows = await db.execute(sql`SELECT COUNT(*) as count FROM webhook_deliveries WHERE webhook_id = ${parseInt(webhookId)}`)
    } else {
      deliveriesRows = await db.execute(sql`
        SELECT wd.*, w.name as webhook_name, w.url as webhook_url
        FROM webhook_deliveries wd
        JOIN webhooks w ON wd.webhook_id = w.id
        ORDER BY wd.created_at DESC LIMIT ${limit} OFFSET ${offset}
      `)
      totalRows = await db.execute(sql`SELECT COUNT(*) as count FROM webhook_deliveries`)
    }

    const total = Number((totalRows.rows[0] as any)?.count ?? 0)

    return NextResponse.json({ deliveries: deliveriesRows.rows, total })
  } catch (error) {
    console.error('GET /api/webhooks/deliveries error:', error)
    return NextResponse.json({ error: 'Failed to fetch deliveries' }, { status: 500 })
  }
}
