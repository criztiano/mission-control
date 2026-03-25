import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { heavyLimiter } from '@/lib/rate-limit'

interface SearchResult {
  type: 'task' | 'agent' | 'activity' | 'audit' | 'message' | 'notification' | 'webhook' | 'pipeline'
  id: number
  title: string
  subtitle?: string
  excerpt?: string
  created_at: number
  relevance: number
}

/**
 * GET /api/search?q=<query>&type=<optional type filter>&limit=<optional>
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim()
  const typeFilter = searchParams.get('type')
  const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100)

  if (!query || query.length < 2) {
    return NextResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 })
  }

  const likeQ = `%${query}%`
  const results: SearchResult[] = []

  // Search tasks
  if (!typeFilter || typeFilter === 'task') {
    try {
      const rows = await db.execute(sql`
        SELECT id, title, description, status, assigned_to, created_at
        FROM tasks WHERE title ILIKE ${likeQ} OR description ILIKE ${likeQ} OR assigned_to ILIKE ${likeQ}
        ORDER BY created_at DESC LIMIT ${limit}
      `)
      for (const t of rows.rows as any[]) {
        results.push({
          type: 'task', id: t.id, title: t.title,
          subtitle: `${t.status} ${t.assigned_to ? `· ${t.assigned_to}` : ''}`,
          excerpt: truncateMatch(t.description, query),
          created_at: t.created_at,
          relevance: t.title.toLowerCase().includes(query.toLowerCase()) ? 2 : 1,
        })
      }
    } catch {}
  }

  // Search agents
  if (!typeFilter || typeFilter === 'agent') {
    try {
      const rows = await db.execute(sql`
        SELECT id, name, role, status, last_activity, created_at
        FROM agents WHERE name ILIKE ${likeQ} OR role ILIKE ${likeQ} OR last_activity ILIKE ${likeQ}
        ORDER BY created_at DESC LIMIT ${limit}
      `)
      for (const a of rows.rows as any[]) {
        results.push({
          type: 'agent', id: a.id, title: a.name,
          subtitle: `${a.role} · ${a.status}`,
          excerpt: a.last_activity,
          created_at: a.created_at,
          relevance: a.name.toLowerCase().includes(query.toLowerCase()) ? 2 : 1,
        })
      }
    } catch {}
  }

  // Search activities
  if (!typeFilter || typeFilter === 'activity') {
    try {
      const rows = await db.execute(sql`
        SELECT id, type, actor, description, created_at
        FROM activities WHERE description ILIKE ${likeQ} OR actor ILIKE ${likeQ}
        ORDER BY created_at DESC LIMIT ${limit}
      `)
      for (const a of rows.rows as any[]) {
        results.push({
          type: 'activity', id: a.id, title: a.description,
          subtitle: `by ${a.actor}`,
          created_at: a.created_at, relevance: 1,
        })
      }
    } catch {}
  }

  // Search audit log
  if (!typeFilter || typeFilter === 'audit') {
    try {
      const rows = await db.execute(sql`
        SELECT id, action, actor, detail, created_at
        FROM audit_log WHERE action ILIKE ${likeQ} OR actor ILIKE ${likeQ} OR detail ILIKE ${likeQ}
        ORDER BY created_at DESC LIMIT ${limit}
      `)
      for (const a of rows.rows as any[]) {
        results.push({
          type: 'audit', id: a.id, title: a.action,
          subtitle: `by ${a.actor}`,
          excerpt: truncateMatch(a.detail, query),
          created_at: a.created_at, relevance: 1,
        })
      }
    } catch {}
  }

  // Search messages
  if (!typeFilter || typeFilter === 'message') {
    try {
      const rows = await db.execute(sql`
        SELECT id, from_agent, to_agent, content, conversation_id, created_at
        FROM messages WHERE content ILIKE ${likeQ} OR from_agent ILIKE ${likeQ}
        ORDER BY created_at DESC LIMIT ${limit}
      `)
      for (const m of rows.rows as any[]) {
        results.push({
          type: 'message', id: m.id,
          title: `${m.from_agent} → ${m.to_agent || 'all'}`,
          subtitle: m.conversation_id,
          excerpt: truncateMatch(m.content, query),
          created_at: m.created_at, relevance: 1,
        })
      }
    } catch {}
  }

  // Search webhooks
  if (!typeFilter || typeFilter === 'webhook') {
    try {
      const rows = await db.execute(sql`
        SELECT id, name, url, events, created_at
        FROM webhooks WHERE name ILIKE ${likeQ} OR url ILIKE ${likeQ}
        ORDER BY created_at DESC LIMIT ${limit}
      `)
      for (const w of rows.rows as any[]) {
        results.push({
          type: 'webhook', id: w.id, title: w.name,
          subtitle: w.url,
          created_at: w.created_at,
          relevance: w.name.toLowerCase().includes(query.toLowerCase()) ? 2 : 1,
        })
      }
    } catch {}
  }

  // Search pipelines
  if (!typeFilter || typeFilter === 'pipeline') {
    try {
      const rows = await db.execute(sql`
        SELECT id, name, description, created_at
        FROM workflow_pipelines WHERE name ILIKE ${likeQ} OR description ILIKE ${likeQ}
        ORDER BY created_at DESC LIMIT ${limit}
      `)
      for (const p of rows.rows as any[]) {
        results.push({
          type: 'pipeline', id: p.id, title: p.name,
          excerpt: truncateMatch(p.description, query),
          created_at: p.created_at,
          relevance: p.name.toLowerCase().includes(query.toLowerCase()) ? 2 : 1,
        })
      }
    } catch {}
  }

  results.sort((a, b) => b.relevance - a.relevance || b.created_at - a.created_at)

  return NextResponse.json({ query, count: results.length, results: results.slice(0, limit) })
}

function truncateMatch(text: string | null, query: string, maxLen = 120): string | undefined {
  if (!text) return undefined
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '...' : '')
  const start = Math.max(0, idx - 40)
  const end = Math.min(text.length, idx + query.length + 80)
  const excerpt = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')
  return excerpt
}
