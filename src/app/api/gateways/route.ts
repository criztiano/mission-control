import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { gateways, auditLog } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'

type GatewayRow = typeof gateways.$inferSelect

function redactToken(gw: GatewayRow): GatewayRow & { token_set: boolean } {
  return { ...gw, token: gw.token ? '--------' : '', token_set: !!gw.token }
}

function redactTokens(gws: GatewayRow[]) {
  return gws.map(redactToken)
}

/**
 * GET /api/gateways - List all registered gateways
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let gwList = await db.select().from(gateways).orderBy(sql`is_primary DESC, name ASC`)

  // Seed defaults if empty
  if (gwList.length === 0) {
    const name = String(process.env.MC_DEFAULT_GATEWAY_NAME || 'primary')
    const host = String(process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1')
    const mainPort = parseInt(process.env.OPENCLAW_GATEWAY_PORT || process.env.GATEWAY_PORT || process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789')
    const mainToken = process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || ''

    await db.insert(gateways).values({ name, host, port: mainPort, token: mainToken, is_primary: true })
    gwList = await db.select().from(gateways).orderBy(sql`is_primary DESC, name ASC`)
  }

  return NextResponse.json({ gateways: redactTokens(gwList) })
}

/**
 * POST /api/gateways - Add a new gateway
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  const { name, host, port, token, is_primary } = body

  if (!name || !host || !port) {
    return NextResponse.json({ error: 'name, host, and port are required' }, { status: 400 })
  }

  try {
    if (is_primary) {
      await db.update(gateways).set({ is_primary: false })
    }

    const result = await db.insert(gateways).values({
      name, host, port, token: token || '', is_primary: is_primary ? true : false
    }).returning()

    try {
      await db.insert(auditLog).values({
        action: 'gateway_added',
        actor: auth.user?.username || 'system',
        detail: `Added gateway: ${name} (${host}:${port})`,
      })
    } catch { /* audit might not exist */ }

    return NextResponse.json({ gateway: redactToken(result[0]) }, { status: 201 })
  } catch (err: any) {
    if (err.message?.includes('unique') || err.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'A gateway with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: err.message || 'Failed to add gateway' }, { status: 500 })
  }
}

/**
 * PUT /api/gateways - Update a gateway
 */
export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const existingRows = await db.select().from(gateways).where(eq(gateways.id, id)).limit(1)
  if (!existingRows[0]) return NextResponse.json({ error: 'Gateway not found' }, { status: 404 })

  if (updates.is_primary) {
    await db.update(gateways).set({ is_primary: false })
  }

  const allowed = ['name', 'host', 'port', 'token', 'is_primary', 'status', 'last_seen', 'latency', 'sessions_count', 'agents_count']
  const updateData: any = { updated_at: Math.floor(Date.now() / 1000) }

  for (const key of allowed) {
    if (key in updates) {
      updateData[key] = updates[key]
    }
  }

  if (Object.keys(updateData).length === 1) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })

  const updated = await db.update(gateways).set(updateData).where(eq(gateways.id, id)).returning()
  return NextResponse.json({ gateway: redactToken(updated[0]) })
}

/**
 * DELETE /api/gateways - Remove a gateway
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const gwRows = await db.select().from(gateways).where(eq(gateways.id, id)).limit(1)
  const gw = gwRows[0]
  if (gw?.is_primary) {
    return NextResponse.json({ error: 'Cannot delete the primary gateway' }, { status: 400 })
  }

  await db.delete(gateways).where(eq(gateways.id, id))

  try {
    await db.insert(auditLog).values({
      action: 'gateway_removed',
      actor: auth.user?.username || 'system',
      detail: `Removed gateway: ${gw?.name}`,
    })
  } catch { /* audit might not exist */ }

  return NextResponse.json({ deleted: true })
}
