import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { webhooks, webhookDeliveries } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { createHmac } from 'crypto'

/**
 * POST /api/webhooks/test - Send a test event to a webhook
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await request.json()

    if (!id) return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 })

    const webhookRows = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1)
    const webhook = webhookRows[0]
    if (!webhook) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

    const body = JSON.stringify({
      event: 'test.ping',
      timestamp: Math.floor(Date.now() / 1000),
      data: {
        message: 'This is a test webhook from Eden',
        webhook_id: webhook.id,
        webhook_name: webhook.name,
        triggered_by: auth.user.username,
      },
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'MissionControl-Webhook/1.0',
      'X-MC-Event': 'test.ping',
    }

    if (webhook.secret) {
      const sig = createHmac('sha256', webhook.secret).update(body).digest('hex')
      headers['X-MC-Signature'] = `sha256=${sig}`
    }

    const start = Date.now()
    let statusCode: number | null = null
    let responseBody: string | null = null
    let error: string | null = null

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const res = await fetch(webhook.url, { method: 'POST', headers, body, signal: controller.signal })
      clearTimeout(timeout)
      statusCode = res.status
      responseBody = await res.text().catch(() => null)
      if (responseBody && responseBody.length > 1000) {
        responseBody = responseBody.slice(0, 1000) + '...'
      }
    } catch (err: any) {
      error = err.name === 'AbortError' ? 'Timeout (10s)' : err.message
    }

    const durationMs = Date.now() - start
    const now = Math.floor(Date.now() / 1000)

    await db.insert(webhookDeliveries).values({
      webhook_id: webhook.id,
      event_type: 'test.ping',
      payload: body,
      status_code: statusCode,
      response_body: responseBody,
      error,
      duration_ms: durationMs,
    })

    await db.update(webhooks).set({ last_fired_at: now, last_status: statusCode ?? -1, updated_at: now }).where(eq(webhooks.id, webhook.id))

    const success = statusCode !== null && statusCode >= 200 && statusCode < 300

    return NextResponse.json({ success, status_code: statusCode, response_body: responseBody, error, duration_ms: durationMs })
  } catch (error) {
    console.error('POST /api/webhooks/test error:', error)
    return NextResponse.json({ error: 'Failed to test webhook' }, { status: 500 })
  }
}
