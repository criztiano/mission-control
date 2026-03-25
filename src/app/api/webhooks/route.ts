import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { webhooks, webhookDeliveries } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { randomBytes } from 'crypto'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, createWebhookSchema } from '@/lib/validation'

/**
 * GET /api/webhooks - List all webhooks with delivery stats
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const rows = await db.execute(sql`
      SELECT w.*,
        (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id) as total_deliveries,
        (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id AND wd.status_code BETWEEN 200 AND 299) as successful_deliveries,
        (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id AND (wd.error IS NOT NULL OR wd.status_code NOT BETWEEN 200 AND 299)) as failed_deliveries
      FROM webhooks w
      ORDER BY w.created_at DESC
    `)

    const result = (rows.rows as any[]).map((wh) => ({
      ...wh,
      events: JSON.parse(wh.events || '["*"]'),
      secret: wh.secret ? '••••••' + wh.secret.slice(-4) : null,
      enabled: !!wh.enabled,
    }))

    return NextResponse.json({ webhooks: result })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/webhooks error')
    return NextResponse.json({ error: 'Failed to fetch webhooks' }, { status: 500 })
  }
}

/**
 * POST /api/webhooks - Create a new webhook
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const validated = await validateBody(request, createWebhookSchema)
    if ('error' in validated) return validated.error
    const body = validated.data
    const { name, url, events, generate_secret } = body

    const secret = generate_secret !== false ? randomBytes(32).toString('hex') : null
    const eventsJson = JSON.stringify(events || ['*'])

    const result = await db.insert(webhooks).values({
      name,
      url,
      secret,
      events: eventsJson,
      created_by: auth.user.username,
    }).returning({ id: webhooks.id })

    return NextResponse.json({
      id: result[0].id,
      name,
      url,
      secret,
      events: events || ['*'],
      enabled: true,
      message: "Webhook created. Save the secret - it won't be shown again in full.",
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/webhooks error')
    return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 })
  }
}

/**
 * PUT /api/webhooks - Update a webhook
 */
export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const { id, name, url, events, enabled, regenerate_secret } = body

    if (!id) return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 })

    const existingRows = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1)
    if (!existingRows[0]) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

    if (url) {
      try { new URL(url) } catch { return NextResponse.json({ error: 'Invalid URL' }, { status: 400 }) }
    }

    const now = Math.floor(Date.now() / 1000)
    const updateData: any = { updated_at: now }

    if (name !== undefined) updateData.name = name
    if (url !== undefined) updateData.url = url
    if (events !== undefined) updateData.events = JSON.stringify(events)
    if (enabled !== undefined) updateData.enabled = enabled

    let newSecret: string | null = null
    if (regenerate_secret) {
      newSecret = randomBytes(32).toString('hex')
      updateData.secret = newSecret
    }

    await db.update(webhooks).set(updateData).where(eq(webhooks.id, id))

    return NextResponse.json({
      success: true,
      ...(newSecret ? { secret: newSecret, message: 'New secret generated. Save it now.' } : {}),
    })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/webhooks error')
    return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 })
  }
}

/**
 * DELETE /api/webhooks - Delete a webhook
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    let body: any
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
    const id = body.id

    if (!id) return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 })

    await db.delete(webhookDeliveries).where(eq(webhookDeliveries.webhook_id, id))
    const deleted = await db.delete(webhooks).where(eq(webhooks.id, id)).returning({ id: webhooks.id })

    if (!deleted.length) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/webhooks error')
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 })
  }
}
