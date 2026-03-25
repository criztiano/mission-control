import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createUser, getUserFromRequest, requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { accessRequests, users } from '@/db/schema'
import { logAuditEvent } from '@/lib/db'
import { eq, sql, or, and } from 'drizzle-orm'
import { validateBody, accessRequestActionSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'

function makeUsernameFromEmail(email: string): string {
  const base = email.split('@')[0].replace(/[^a-z0-9._-]/gi, '').toLowerCase() || 'user'
  return base.slice(0, 28)
}

async function ensureUniqueUsername(base: string): Promise<string> {
  let candidate = base
  let i = 0
  while (true) {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, candidate)).limit(1)
    if (!existing.length) break
    i += 1
    candidate = `${base.slice(0, 24)}-${i}`
  }
  return candidate
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const user = getUserFromRequest(request)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const status = String(request.nextUrl.searchParams.get('status') || 'all')
  
  let rows;
  if (status === 'all') {
    rows = await db.select().from(accessRequests)
      .orderBy(sql`status = 'pending' DESC, last_attempt_at DESC, id DESC`)
  } else {
    rows = await db.select().from(accessRequests)
      .where(eq(accessRequests.status, status))
      .orderBy(sql`last_attempt_at DESC, id DESC`)
  }

  return NextResponse.json({ requests: rows })
}

export async function POST(request: NextRequest) {
  const admin = getUserFromRequest(request)
  if (!admin || admin.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, accessRequestActionSchema)
  if ('error' in result) return result.error

  const { request_id: requestId, action, role, note } = result.data

  const reqRows = await db.select().from(accessRequests).where(eq(accessRequests.id, requestId)).limit(1)
  const reqRow = reqRows[0]
  if (!reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  const now = Math.floor(Date.now() / 1000)

  if (action === 'reject') {
    await db.update(accessRequests).set({
      status: 'rejected',
      reviewed_by: admin.username,
      reviewed_at: now,
      review_note: note || null,
    }).where(eq(accessRequests.id, requestId))

    logAuditEvent({
      action: 'access_request_rejected',
      actor: admin.username,
      actor_id: admin.id,
      detail: { request_id: requestId, email: reqRow.email, note },
    })

    return NextResponse.json({ ok: true })
  }

  const email = String(reqRow.email || '').toLowerCase()
  const providerUserId = reqRow.provider_user_id ? String(reqRow.provider_user_id) : null
  const displayName = String(reqRow.display_name || email.split('@')[0] || 'Google User')
  const avatarUrl = reqRow.avatar_url ? String(reqRow.avatar_url) : null

  // Find or create user
  const existingRows = await db.select().from(users).where(
    or(
      sql`lower(${users.email}) = ${email}`,
      and(eq(users.provider, 'google'), eq(users.provider_user_id, providerUserId || ''))
    )
  ).orderBy(sql`id ASC`).limit(1)
  const existing = existingRows[0]

  let userId: number
  if (existing) {
    await db.update(users).set({
      provider: 'google',
      provider_user_id: providerUserId,
      email,
      avatar_url: avatarUrl ?? existing.avatar_url,
      is_approved: true,
      role: role || existing.role,
      approved_by: admin.username,
      approved_at: now,
      updated_at: now,
    }).where(eq(users.id, existing.id))
    userId = existing.id
  } else {
    const username = await ensureUniqueUsername(makeUsernameFromEmail(email))
    const randomPwd = randomBytes(24).toString('hex')
    const created = await createUser(username, randomPwd, displayName, role || 'operator', {
      provider: 'google',
      provider_user_id: providerUserId,
      email,
      avatar_url: avatarUrl,
      is_approved: 1,
      approved_by: admin.username,
      approved_at: now,
    })
    userId = (created as any).id
  }

  await db.update(accessRequests).set({
    status: 'approved',
    reviewed_by: admin.username,
    reviewed_at: now,
    review_note: note || null,
    approved_user_id: userId,
  }).where(eq(accessRequests.id, requestId))

  const userRows = await db.select({
    id: users.id,
    username: users.username,
    display_name: users.display_name,
    role: users.role,
    provider: users.provider,
    email: users.email,
    avatar_url: users.avatar_url,
    is_approved: users.is_approved,
  }).from(users).where(eq(users.id, userId)).limit(1)

  await logAuditEvent({
    action: 'access_request_approved',
    actor: admin.username,
    actor_id: admin.id,
    detail: { request_id: requestId, email, role, user_id: userId, note },
  })

  return NextResponse.json({ ok: true, user: userRows[0] })
}
