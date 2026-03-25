import { randomBytes, timingSafeEqual } from 'crypto'
import { db } from '@/db/client'
import { users, userSessions } from '@/db/schema'
import { eq, and, gt, lt, desc } from 'drizzle-orm'
import { hashPassword, verifyPassword } from './password'

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export interface User {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  provider?: 'local' | 'google'
  email?: string | null
  avatar_url?: string | null
  is_approved?: number
  created_at: number
  updated_at: number
  last_login_at: number | null
}

export interface UserSession {
  id: number
  token: string
  user_id: number
  expires_at: number
  created_at: number
  ip_address: string | null
  user_agent: string | null
}

// Session management
const SESSION_DURATION = 7 * 24 * 60 * 60 // 7 days in seconds

export async function createSession(userId: number, ipAddress?: string, userAgent?: string): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString('hex')
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + SESSION_DURATION

  await db.insert(userSessions).values({
    token,
    user_id: userId,
    expires_at: expiresAt,
    created_at: now,
    ip_address: ipAddress || null,
    user_agent: userAgent || null,
  })

  // Update user's last login
  await db.update(users).set({ last_login_at: now, updated_at: now }).where(eq(users.id, userId))

  // Clean up expired sessions
  await db.delete(userSessions).where(lt(userSessions.expires_at, now))

  return { token, expiresAt }
}

export async function validateSession(token: string): Promise<(User & { sessionId: number }) | null> {
  if (!token) return null
  const now = Math.floor(Date.now() / 1000)

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      display_name: users.display_name,
      role: users.role,
      provider: users.provider,
      email: users.email,
      avatar_url: users.avatar_url,
      is_approved: users.is_approved,
      created_at: users.created_at,
      updated_at: users.updated_at,
      last_login_at: users.last_login_at,
      session_id: userSessions.id,
    })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.user_id))
    .where(and(eq(userSessions.token, token), gt(userSessions.expires_at, now)))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role as User['role'],
    provider: (row.provider as 'local' | 'google') || 'local',
    email: row.email ?? null,
    avatar_url: row.avatar_url ?? null,
    is_approved: typeof row.is_approved === 'boolean' ? (row.is_approved ? 1 : 0) : (row.is_approved ?? 1),
    created_at: row.created_at ?? 0,
    updated_at: row.updated_at ?? 0,
    last_login_at: row.last_login_at ?? null,
    sessionId: row.session_id,
  }
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(userSessions).where(eq(userSessions.token, token))
}

export async function destroyAllUserSessions(userId: number): Promise<void> {
  await db.delete(userSessions).where(eq(userSessions.user_id, userId))
}

// User management
export async function authenticateUser(username: string, password: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1)
  const row = rows[0]
  if (!row) return null
  if ((row.provider || 'local') !== 'local') return null
  if (!row.is_approved) return null
  if (!verifyPassword(password, row.password_hash)) return null
  return rowToUser(row)
}

export async function getUserById(id: number): Promise<User | null> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      display_name: users.display_name,
      role: users.role,
      provider: users.provider,
      email: users.email,
      avatar_url: users.avatar_url,
      is_approved: users.is_approved,
      created_at: users.created_at,
      updated_at: users.updated_at,
      last_login_at: users.last_login_at,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  return rows[0] ? rowToUser(rows[0]) : null
}

export async function getAllUsers(): Promise<User[]> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      display_name: users.display_name,
      role: users.role,
      provider: users.provider,
      email: users.email,
      avatar_url: users.avatar_url,
      is_approved: users.is_approved,
      created_at: users.created_at,
      updated_at: users.updated_at,
      last_login_at: users.last_login_at,
    })
    .from(users)
    .orderBy(users.created_at)
  return rows.map(rowToUser)
}

export async function createUser(
  username: string,
  password: string,
  displayName: string,
  role: User['role'] = 'operator',
  options?: { provider?: 'local' | 'google'; provider_user_id?: string | null; email?: string | null; avatar_url?: string | null; is_approved?: 0 | 1; approved_by?: string | null; approved_at?: number | null }
): Promise<User> {
  const passwordHash = hashPassword(password)
  const provider = options?.provider || 'local'
  const result = await db
    .insert(users)
    .values({
      username,
      display_name: displayName,
      password_hash: passwordHash,
      role,
      provider,
      provider_user_id: options?.provider_user_id || null,
      email: options?.email || null,
      avatar_url: options?.avatar_url || null,
      is_approved: typeof options?.is_approved === 'number' ? (options.is_approved === 1) : true,
      approved_by: options?.approved_by || null,
      approved_at: options?.approved_at || null,
    })
    .returning({ id: users.id })

  return (await getUserById(result[0].id))!
}

export async function updateUser(id: number, updates: { display_name?: string; role?: User['role']; password?: string; email?: string | null; avatar_url?: string | null; is_approved?: 0 | 1 }): Promise<User | null> {
  const fields: Record<string, any> = {}
  if (updates.display_name !== undefined) fields.display_name = updates.display_name
  if (updates.role !== undefined) fields.role = updates.role
  if (updates.password !== undefined) fields.password_hash = hashPassword(updates.password)
  if (updates.email !== undefined) fields.email = updates.email
  if (updates.avatar_url !== undefined) fields.avatar_url = updates.avatar_url
  if (updates.is_approved !== undefined) fields.is_approved = updates.is_approved === 1

  if (Object.keys(fields).length === 0) return getUserById(id)

  fields.updated_at = Math.floor(Date.now() / 1000)
  await db.update(users).set(fields).where(eq(users.id, id))
  return getUserById(id)
}

export async function deleteUser(id: number): Promise<boolean> {
  await destroyAllUserSessions(id)
  const result = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id })
  return result.length > 0
}

/**
 * Get user from request - checks session cookie or API key.
 * For API key auth, returns a synthetic "api" user.
 * NOTE: This is synchronous for compatibility — session validation is cached via headers.
 */
export function getUserFromRequest(request: Request): User | null {
  // Check API key first — synchronous and quick
  const apiKey = request.headers.get('x-api-key')
  if (apiKey && safeCompare(apiKey, process.env.API_KEY || '')) {
    return {
      id: 0,
      username: 'api',
      display_name: 'API Access',
      role: 'admin',
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
    }
  }

  // Session cookie validation requires DB — return null here, callers use requireRole() which is async-safe
  // For cookie auth, use validateSessionFromRequest() in async contexts
  const cookieHeader = request.headers.get('cookie') || ''
  const sessionToken = parseCookie(cookieHeader, 'mc-session')
  if (sessionToken) {
    // We can't await here in a sync function — but requireRole handles this
    // Return null and let requireRole handle async validation
    return null
  }

  return null
}

/**
 * Async version: get user from request, validates session from DB.
 */
export async function getUserFromRequestAsync(request: Request): Promise<User | null> {
  // Check API key first
  const apiKey = request.headers.get('x-api-key')
  if (apiKey && safeCompare(apiKey, process.env.API_KEY || '')) {
    return {
      id: 0,
      username: 'api',
      display_name: 'API Access',
      role: 'admin',
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
    }
  }

  // Check session cookie
  const cookieHeader = request.headers.get('cookie') || ''
  const sessionToken = parseCookie(cookieHeader, 'mc-session')
  if (sessionToken) {
    const user = await validateSession(sessionToken)
    if (user) return user
  }

  return null
}

/**
 * Role hierarchy levels for access control.
 * viewer < operator < admin
 */
const ROLE_LEVELS: Record<string, number> = { viewer: 0, operator: 1, admin: 2 }

/**
 * requireRole — validates API key or session cookie.
 * Now async to support cookie-based session validation via DB.
 * All route handlers should await this.
 */
export async function requireRole(
  request: Request,
  minRole: User['role']
): Promise<{ user: User; error?: never; status?: never } | { user?: never; error: string; status: 401 | 403 }> {
  const user = await getUserFromRequestAsync(request)
  if (!user) {
    return { error: 'Authentication required', status: 401 }
  }
  if ((ROLE_LEVELS[user.role] ?? -1) < ROLE_LEVELS[minRole]) {
    return { error: `Requires ${minRole} role or higher`, status: 403 }
  }
  return { user }
}

/**
 * @deprecated Use requireRole() — it's now async.
 */
export const requireRoleAsync = requireRole

function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role as User['role'],
    provider: (row.provider as 'local' | 'google') || 'local',
    email: row.email ?? null,
    avatar_url: row.avatar_url ?? null,
    is_approved: typeof row.is_approved === 'boolean' ? (row.is_approved ? 1 : 0) : (row.is_approved ?? 1),
    created_at: row.created_at ?? 0,
    updated_at: row.updated_at ?? 0,
    last_login_at: row.last_login_at ?? null,
  }
}
