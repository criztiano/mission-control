import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { randomUUID } from 'node:crypto'
import { db } from '@/db/client'
import { digests } from '@/db/schema'
import { desc, sql } from 'drizzle-orm'

/**
 * POST /api/feed/digest — Store a structured digest from Worm
 */
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json()
  const { label, items, stats } = body

  if (!label || !items || !Array.isArray(items)) {
    return NextResponse.json({ error: 'label and items[] required' }, { status: 400 })
  }

  const id = randomUUID()
  const now = new Date().toISOString()

  await db.insert(digests).values({
    id,
    label,
    items: JSON.stringify(items),
    stats: JSON.stringify(stats || {}),
    brief: '',
    created_at: now,
  })

  return NextResponse.json({ id, label, itemCount: items.length }, { status: 201 })
}

/**
 * GET /api/feed/digest — List recent digests
 */
export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') || '10')

  try {
    const digestRows = await db
      .select()
      .from(digests)
      .orderBy(desc(digests.created_at))
      .limit(limit)

    return NextResponse.json({
      digests: digestRows.map(d => ({
        ...d,
        items: d.items ? JSON.parse(d.items) : [],
        stats: d.stats ? JSON.parse(d.stats) : null,
      })),
    })
  } catch {
    return NextResponse.json({ digests: [] })
  }
}
