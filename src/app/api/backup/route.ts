import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { config, ensureDirExists } from '@/lib/config'
import { join } from 'path'
import { readdirSync, statSync, unlinkSync } from 'fs'
import { heavyLimiter } from '@/lib/rate-limit'

const BACKUP_DIR = join(config.dataDir, 'backups')
const MAX_BACKUPS = 10

/**
 * GET /api/backup - List existing backups (admin only)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  ensureDirExists(BACKUP_DIR)

  try {
    const files = readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.sql') || f.endsWith('.dump'))
      .map(f => {
        const stat = statSync(join(BACKUP_DIR, f))
        return {
          name: f,
          size: stat.size,
          created_at: Math.floor(stat.mtimeMs / 1000),
        }
      })
      .sort((a, b) => b.created_at - a.created_at)

    return NextResponse.json({ backups: files, dir: BACKUP_DIR })
  } catch {
    return NextResponse.json({ backups: [], dir: BACKUP_DIR })
  }
}

/**
 * POST /api/backup - Create a new backup (admin only)
 * NOTE: SQLite backup not available — database is now Neon Postgres.
 * Use the Neon dashboard for backups and point-in-time recovery.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json(
    {
      error: 'Backup not available: database is now managed by Neon Postgres. Use the Neon dashboard for backups and point-in-time recovery.',
      neon_dashboard: 'https://console.neon.tech',
    },
    { status: 501 }
  )
}

/**
 * DELETE /api/backup?name=<filename> - Delete a specific backup (admin only)
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
  const name = body.name

  if (!name || (!name.endsWith('.sql') && !name.endsWith('.dump')) || name.includes('/') || name.includes('..')) {
    return NextResponse.json({ error: 'Invalid backup name' }, { status: 400 })
  }

  try {
    const fullPath = join(BACKUP_DIR, name)
    unlinkSync(fullPath)

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    await logAuditEvent({
      action: 'backup_delete',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { name },
      ip_address: ipAddress,
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Backup not found' }, { status: 404 })
  }
}
