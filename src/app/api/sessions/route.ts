import { NextRequest, NextResponse } from 'next/server'
import { getAllGatewaySessions } from '@/lib/sessions'
import { requireRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const gatewaySessions = getAllGatewaySessions()

    // On Vercel, OPENCLAW_HOME is not set — getAllGatewaySessions returns [].
    // Return a clear source signal so the client can distinguish "no sessions"
    // from "session data unavailable".
    const source = process.env.OPENCLAW_HOME ? 'filesystem' : 'none'
    const reason = source === 'none' ? 'OPENCLAW_HOME not available — sessions stream via Gateway WS' : undefined

    const sessions = gatewaySessions.map((s) => {
      const total = s.totalTokens || 0
      const context = s.contextTokens || 35000
      const pct = context > 0 ? Math.round((total / context) * 100) : 0
      return {
        id: s.sessionId || s.key,
        key: s.key,
        agent: s.agent,
        kind: s.chatType || 'unknown',
        age: formatAge(s.updatedAt),
        model: s.model,
        tokens: `${formatTokens(total)}/${formatTokens(context)} (${pct}%)`,
        channel: s.channel,
        flags: [],
        active: s.active,
        startTime: s.updatedAt,
        lastActivity: s.updatedAt,
      }
    })

    return NextResponse.json({ sessions, source, ...(reason ? { reason } : {}) })
  } catch (error) {
    console.error('Sessions API error:', error)
    return NextResponse.json({ sessions: [], source: 'error' })
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatAge(timestamp: number): string {
  if (!timestamp) return '-'
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

export const dynamic = 'force-dynamic'
