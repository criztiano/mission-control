import { NextRequest, NextResponse } from "next/server"
import { db } from '@/db/client'
import { gateways } from '@/db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { requireRole } from "@/lib/auth"

interface HealthResult {
  id: number
  name: string
  status: "online" | "offline" | "error"
  latency: number | null
  agents: string[]
  sessions_count: number
  error?: string
}

function isBlockedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    const hostname = url.hostname
    if (hostname.startsWith('169.254.')) return true
    if (hostname === 'metadata.google.internal') return true
    return false
  } catch {
    return true
  }
}

/**
 * POST /api/gateways/health - Server-side health probe for all gateways
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "viewer")
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const gwRows = await db.select().from(gateways).orderBy(sql`is_primary DESC, name ASC`)
  const results: HealthResult[] = []

  for (const gw of gwRows) {
    const probeUrl = "http://" + gw.host + ":" + gw.port + "/"

    if (isBlockedUrl(probeUrl)) {
      results.push({ id: gw.id, name: gw.name, status: 'error', latency: null, agents: [], sessions_count: 0, error: 'Blocked URL' })
      continue
    }

    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const res = await fetch(probeUrl, { signal: controller.signal })
      clearTimeout(timeout)

      const latency = Date.now() - start
      const status = res.ok ? "online" : "error"

      const now = Math.floor(Date.now() / 1000)
      await db.update(gateways).set({ status, latency, last_seen: now, updated_at: now }).where(eq(gateways.id, gw.id))

      results.push({ id: gw.id, name: gw.name, status: status as "online" | "error", latency, agents: [], sessions_count: 0 })
    } catch (err: any) {
      const now = Math.floor(Date.now() / 1000)
      await db.update(gateways).set({ status: 'offline', latency: null, updated_at: now }).where(eq(gateways.id, gw.id))

      results.push({
        id: gw.id,
        name: gw.name,
        status: "offline" as const,
        latency: null,
        agents: [],
        sessions_count: 0,
        error: err.name === "AbortError" ? "timeout" : (err.message || "connection failed"),
      })
    }
  }

  return NextResponse.json({ results, probed_at: Date.now() })
}
