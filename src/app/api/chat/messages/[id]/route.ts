import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { messages } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'

/**
 * GET /api/chat/messages/[id] - Get a single message
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params

    const rows = await db.select().from(messages).where(eq(messages.id, parseInt(id))).limit(1)
    const message = rows[0]

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    return NextResponse.json({
      message: {
        ...message,
        metadata: message.metadata ? JSON.parse(message.metadata) : null,
      },
    })
  } catch (error) {
    console.error('GET /api/chat/messages/[id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch message' }, { status: 500 })
  }
}

/**
 * PATCH /api/chat/messages/[id] - Mark message as read
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await request.json()
    const msgId = parseInt(id)

    const rows = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1)
    const message = rows[0]

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    let updated = message
    if (body.read) {
      const now = Math.floor(Date.now() / 1000)
      const updatedRows = await db.update(messages).set({ read_at: now }).where(eq(messages.id, msgId)).returning()
      updated = updatedRows[0]
    }

    return NextResponse.json({
      message: {
        ...updated,
        metadata: updated.metadata ? JSON.parse(updated.metadata) : null,
      },
    })
  } catch (error) {
    console.error('PATCH /api/chat/messages/[id] error:', error)
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 })
  }
}
