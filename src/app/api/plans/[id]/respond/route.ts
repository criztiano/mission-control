import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { type CCPlan } from '@/lib/cc-db'
import { logger } from '@/lib/logger'
import { db } from '@/db/client'
import { plans } from '@/db/schema'
import { eq } from 'drizzle-orm'

/**
 * PUT /api/plans/:id/respond — merge feedback responses into plan's responses JSON
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await request.json()
    const { responses: incoming } = body

    if (!incoming || typeof incoming !== 'object') {
      return NextResponse.json({ error: 'responses must be an object' }, { status: 400 })
    }

    const existingRows = await db.select().from(plans).where(eq(plans.id, id)).limit(1)
    const existing = existingRows[0] as CCPlan | undefined
    if (!existing) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    let currentResponses: Record<string, unknown> = {}
    try { currentResponses = JSON.parse(existing.responses || '{}') } catch {}

    const merged = { ...currentResponses, ...incoming }

    const now = new Date().toISOString()
    await db.update(plans).set({ responses: JSON.stringify(merged), updated_at: now }).where(eq(plans.id, id))

    logger.info({ planId: id, responseCount: Object.keys(incoming).length }, 'Merged plan responses')
    return NextResponse.json({ success: true, responses: merged })
  } catch (err) {
    logger.error({ err }, 'PUT /api/plans/:id/respond failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
