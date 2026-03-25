import { createHmac } from 'crypto'
import { eventBus, type ServerEvent } from './event-bus'
import { logger } from './logger'
import { db } from '@/db/client'
import { webhooks as webhooksTable, webhookDeliveries } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'

interface Webhook {
  id: number
  name: string
  url: string
  secret: string | null
  events: string // JSON array
  enabled: number | boolean
}

// Map event bus events to webhook event types
const EVENT_MAP: Record<string, string> = {
  'activity.created': 'activity',
  'notification.created': 'notification',
  'agent.status_changed': 'agent.status_change',
  'audit.security': 'security',
  'task.created': 'activity.task_created',
  'task.updated': 'activity.task_updated',
  'task.deleted': 'activity.task_deleted',
}

/**
 * Subscribe to the event bus and fire webhooks for matching events.
 * Called once during server initialization.
 */
export function initWebhookListener() {
  eventBus.on('server-event', (event: ServerEvent) => {
    const mapping = EVENT_MAP[event.type]
    if (!mapping) return

    let webhookEventType: string
    if (mapping === 'activity' && event.data?.type) {
      webhookEventType = `activity.${event.data.type}`
    } else if (mapping === 'notification' && event.data?.type) {
      webhookEventType = `notification.${event.data.type}`
    } else if (mapping === 'security' && event.data?.action) {
      webhookEventType = `security.${event.data.action}`
    } else {
      webhookEventType = mapping
    }

    const isAgentError = event.type === 'agent.status_changed' && event.data?.status === 'error'

    fireWebhooksAsync(webhookEventType, event.data).catch((err) => {
      logger.error({ err }, 'Webhook dispatch error')
    })

    if (isAgentError) {
      fireWebhooksAsync('agent.error', event.data).catch((err) => {
        logger.error({ err }, 'Webhook dispatch error')
      })
    }
  })
}

/**
 * Fire all matching webhooks for an event type (public for test endpoint).
 */
export function fireWebhooks(eventType: string, payload: Record<string, any>) {
  fireWebhooksAsync(eventType, payload).catch((err) => {
    logger.error({ err }, 'Webhook dispatch error')
  })
}

async function fireWebhooksAsync(eventType: string, payload: Record<string, any>) {
  let webhooks: Webhook[]
  try {
    const rows = await db.select().from(webhooksTable).where(eq(webhooksTable.enabled, true))
    webhooks = rows as Webhook[]
  } catch {
    return // DB not ready
  }

  if (webhooks.length === 0) return

  const matchingWebhooks = webhooks.filter((wh) => {
    try {
      const events: string[] = JSON.parse(wh.events)
      return events.includes('*') || events.includes(eventType)
    } catch {
      return false
    }
  })

  await Promise.allSettled(
    matchingWebhooks.map((wh) => deliverWebhook(wh, eventType, payload))
  )
}

async function deliverWebhook(
  webhook: Webhook,
  eventType: string,
  payload: Record<string, any>
) {
  const body = JSON.stringify({
    event: eventType,
    timestamp: Math.floor(Date.now() / 1000),
    data: payload,
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'MissionControl-Webhook/1.0',
    'X-MC-Event': eventType,
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

    const res = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

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

  // Log delivery attempt (best-effort)
  try {
    await db.insert(webhookDeliveries).values({
      webhook_id: webhook.id,
      event_type: eventType,
      payload: body,
      status_code: statusCode,
      response_body: responseBody,
      error,
      duration_ms: durationMs,
      created_at: Math.floor(Date.now() / 1000),
    })

    await db.update(webhooksTable)
      .set({
        last_fired_at: Math.floor(Date.now() / 1000),
        last_status: statusCode ?? -1,
        updated_at: Math.floor(Date.now() / 1000),
      })
      .where(eq(webhooksTable.id, webhook.id))

    // Prune old deliveries (keep last 200 per webhook)
    await db.execute(sql`
      DELETE FROM webhook_deliveries
      WHERE webhook_id = ${webhook.id} AND id NOT IN (
        SELECT id FROM webhook_deliveries WHERE webhook_id = ${webhook.id} ORDER BY created_at DESC LIMIT 200
      )
    `)
  } catch {
    // Silent - delivery logging is best-effort
  }
}
