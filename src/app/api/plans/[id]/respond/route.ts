import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getCCDatabase, getCCDatabaseWrite, type CCPlan } from '@/lib/cc-db'
import { logger } from '@/lib/logger'

/**
 * PUT /api/plans/:id/respond — merge feedback responses into plan's responses JSON
 * Body: { responses: Record<string, PlanResponse> }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await request.json()
    const { responses: incoming } = body

    if (!incoming || typeof incoming !== 'object') {
      return NextResponse.json({ error: 'responses must be an object' }, { status: 400 })
    }

    const readDb = getCCDatabase()
    const existing = readDb.prepare('SELECT * FROM plans WHERE id = ?').get(id) as CCPlan | undefined
    if (!existing) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    // Deep-merge: existing responses + incoming (new keys added, existing keys overwritten)
    let currentResponses: Record<string, unknown> = {}
    try { currentResponses = JSON.parse(existing.responses || '{}') } catch {}

    const merged = { ...currentResponses, ...incoming }

    const db = getCCDatabaseWrite()
    try {
      const now = new Date().toISOString()
      db.prepare('UPDATE plans SET responses = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(merged), now, id)

      logger.info({ planId: id, responseCount: Object.keys(incoming).length }, 'Merged plan responses')
      return NextResponse.json({ success: true, responses: merged })
    } finally {
      db.close()
    }
  } catch (err) {
    logger.error({ err }, 'PUT /api/plans/:id/respond failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
