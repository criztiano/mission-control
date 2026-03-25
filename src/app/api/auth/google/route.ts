import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { createSession } from '@/lib/auth'
import { db } from '@/db/client'
import { accessRequests, users } from '@/db/schema'
import { logAuditEvent } from '@/lib/db'
import { eq, sql, or, and } from 'drizzle-orm'
import { verifyGoogleIdToken } from '@/lib/google-auth'
import { getMcSessionCookieOptions } from '@/lib/session-cookie'

async function upsertAccessRequest(input: {
  email: string
  providerUserId: string
  displayName: string
  avatarUrl?: string
}) {
  const now = Math.floor(Date.now() / 1000)
  // Try update first, then insert
  const existing = await db.select({ id: accessRequests.id, attempt_count: accessRequests.attempt_count })
    .from(accessRequests)
    .where(and(eq(accessRequests.email, input.email.toLowerCase()), eq(accessRequests.provider, 'google')))
    .limit(1)
  
  if (existing[0]) {
    await db.update(accessRequests).set({
      provider_user_id: input.providerUserId,
      display_name: input.displayName,
      avatar_url: input.avatarUrl || null,
      status: 'pending',
      attempt_count: (existing[0].attempt_count || 0) + 1,
      last_attempt_at: now,
    }).where(eq(accessRequests.id, existing[0].id))
  } else {
    await db.insert(accessRequests).values({
      provider: 'google',
      email: input.email.toLowerCase(),
      provider_user_id: input.providerUserId,
      display_name: input.displayName,
      avatar_url: input.avatarUrl || null,
      status: 'pending',
      attempt_count: 1,
      requested_at: now,
      last_attempt_at: now,
    })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const credential = String(body?.credential || '')
    const profile = await verifyGoogleIdToken(credential)

    const email = String(profile.email || '').toLowerCase().trim()
    const sub = String(profile.sub || '').trim()
    const displayName = String(profile.name || email.split('@')[0] || 'Google User').trim()
    const avatar = profile.picture ? String(profile.picture) : null

    const row = (await db.select().from(users).where(
      or(
        and(eq(users.provider, 'google'), eq(users.provider_user_id, sub)),
        sql`lower(${users.email}) = ${email}`
      )
    ).orderBy(sql`id ASC`).limit(1))[0]

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || undefined

    if (!row || !row.is_approved) {
      await upsertAccessRequest({
        email,
        providerUserId: sub,
        displayName,
        avatarUrl: avatar || undefined,
      })

      logAuditEvent({
        action: 'google_login_pending_approval',
        actor: email,
        detail: { email, sub },
        ip_address: ipAddress,
        user_agent: userAgent,
      })

      return NextResponse.json(
        { error: 'Access request pending admin approval', code: 'PENDING_APPROVAL' },
        { status: 403 }
      )
    }

    const now = Math.floor(Date.now() / 1000)
    await db.update(users).set({
      provider: 'google',
      provider_user_id: sub,
      email,
      avatar_url: avatar ?? row.avatar_url,
      updated_at: now,
    }).where(eq(users.id, row.id))

    const { token, expiresAt } = createSession(row.id, ipAddress, userAgent)

    logAuditEvent({ action: 'login_google', actor: row.username, actor_id: row.id, ip_address: ipAddress, user_agent: userAgent })

    const response = NextResponse.json({
      user: {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        provider: 'google',
        email,
        avatar_url: avatar,
      },
    })

    response.cookies.set('mc-session', token, {
      ...getMcSessionCookieOptions({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000) }),
    })

    return response
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Google login failed' }, { status: 400 })
  }
}
