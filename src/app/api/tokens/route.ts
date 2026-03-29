import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, access } from 'fs/promises'
import { dirname } from 'path'
import { config, ensureDirExists } from '@/lib/config'
import { requireRole } from '@/lib/auth'
import { getAllGatewaySessions } from '@/lib/sessions'
import { db } from '@/db/client'
import { tokenUsage } from '@/db/schema'
import { gte, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const DATA_PATH = config.tokensPath

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenUsageRecord {
  id: string
  model: string
  sessionId: string
  timestamp: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  operation: string
  duration?: number
  agentName?: string
}

interface TokenStats {
  totalTokens: number
  totalCost: number
  requestCount: number
  avgTokensPerRequest: number
  avgCostPerRequest: number
}

interface ExportData {
  usage: TokenUsageRecord[]
  summary: TokenStats
  models: Record<string, TokenStats>
  sessions: Record<string, TokenStats>
  providers?: Record<string, TokenStats>
}

// ---------------------------------------------------------------------------
// Model pricing (cost per 1K tokens)
// ---------------------------------------------------------------------------

const MODEL_PRICING: Record<string, number> = {
  'anthropic/claude-3-5-haiku-latest': 0.25,
  'claude-3-5-haiku': 0.25,
  'anthropic/claude-haiku-4-5': 0.25,
  'anthropic/claude-sonnet-4-20250514': 3.0,
  'anthropic/claude-sonnet-4-6': 3.0,
  'claude-sonnet-4': 3.0,
  'anthropic/claude-opus-4-5': 15.0,
  'anthropic/claude-opus-4-6': 15.0,
  'claude-opus-4-5': 15.0,
  'groq/llama-3.1-8b-instant': 0.05,
  'groq/llama-3.3-70b-versatile': 0.59,
  'moonshot/kimi-k2.5': 1.0,
  'minimax/minimax-m2.1': 0.3,
  'ollama/deepseek-r1:14b': 0.0,
  'ollama/qwen2.5-coder:7b': 0.0,
  'ollama/qwen2.5-coder:14b': 0.0,
}

function getModelCost(modelName: string): number {
  if (MODEL_PRICING[modelName] !== undefined) return MODEL_PRICING[modelName]
  for (const [model, cost] of Object.entries(MODEL_PRICING)) {
    if (modelName.includes(model.split('/').pop() || '')) return cost
  }
  return 1.0
}

function getProviderFromModel(model: string): string {
  const m = (model || '').toLowerCase()
  if (m.startsWith('openai-codex/') || m.startsWith('openai/')) return 'openai'
  if (m.startsWith('anthropic/')) return 'anthropic'
  if (m.startsWith('nvidia-nim/')) return 'nvidia-nim'
  if (m.startsWith('openrouter/')) return 'openrouter'
  return (m.split('/')[0] || 'unknown')
}

// ---------------------------------------------------------------------------
// Neon DB — primary source
// ---------------------------------------------------------------------------

function timeframeToCutoff(timeframe: string): number | null {
  const now = Math.floor(Date.now() / 1000)
  switch (timeframe) {
    case 'hour': return now - 3600
    case 'day': return now - 86400
    case 'week': return now - 7 * 86400
    case 'month': return now - 30 * 86400
    case 'all': return null
    default: return null
  }
}

async function loadFromNeon(timeframe: string): Promise<TokenUsageRecord[]> {
  const cutoff = timeframeToCutoff(timeframe)

  const rows = cutoff
    ? await db.select().from(tokenUsage).where(gte(tokenUsage.created_at, cutoff)).orderBy(sql`${tokenUsage.created_at} desc`).limit(5000)
    : await db.select().from(tokenUsage).orderBy(sql`${tokenUsage.created_at} desc`).limit(5000)

  return rows.map((r) => {
    const inputTokens = r.input_tokens || 0
    const outputTokens = r.output_tokens || 0
    const totalTokens = inputTokens + outputTokens
    const costPer1k = r.cost_usd !== null ? null : getModelCost(r.model)
    const cost = r.cost_usd ?? (totalTokens / 1000) * (costPer1k ?? 1.0)
    return {
      id: String(r.id),
      model: r.model,
      sessionId: r.session_id,
      timestamp: (r.created_at || 0) * 1000,
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      operation: 'chat_completion',
      agentName: r.agent_name || undefined,
    }
  })
}

// ---------------------------------------------------------------------------
// Local filesystem fallbacks (dev / local server only)
// ---------------------------------------------------------------------------

async function loadTokenData(timeframe: string): Promise<{ records: TokenUsageRecord[]; source: string }> {
  // 1. Neon DB — works on Vercel
  try {
    const records = await loadFromNeon(timeframe)
    if (records.length > 0) return { records, source: 'neon' }
  } catch (e) {
    console.warn('[tokens] Neon query failed, falling back to local sources:', (e as Error).message)
  }

  // 2. Live gateway sessions (local dev only)
  const live = deriveFromSessions()
  if (live.length > 0) {
    const filtered = filterByTimeframe(live, timeframe)
    return { records: filtered, source: 'sessions' }
  }

  // 3. Persisted JSON file (local dev only)
  try {
    if (DATA_PATH) {
      ensureDirExists(dirname(DATA_PATH))
      await access(DATA_PATH)
      const data = await readFile(DATA_PATH, 'utf-8')
      const allRecords = JSON.parse(data)
      if (Array.isArray(allRecords)) {
        return { records: filterByTimeframe(allRecords, timeframe), source: 'file' }
      }
    }
  } catch {
    // ignore
  }

  return { records: [], source: 'none' }
}

function deriveFromSessions(): TokenUsageRecord[] {
  const sessions = getAllGatewaySessions(Infinity)
  const records: TokenUsageRecord[] = []

  for (const session of sessions) {
    if (!session.totalTokens && !session.model) continue

    const totalTokens = session.totalTokens || 0
    const inputTokens = session.inputTokens || Math.round(totalTokens * 0.7)
    const outputTokens = session.outputTokens || totalTokens - inputTokens
    const costPer1k = getModelCost(session.model || '')
    const cost = (totalTokens / 1000) * costPer1k

    records.push({
      id: `session-${session.agent}-${session.key}`,
      model: session.model || 'unknown',
      sessionId: session.key || `${session.agent}:${session.chatType}`,
      timestamp: session.updatedAt,
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      operation: session.chatType || 'chat',
    })
  }

  records.sort((a, b) => b.timestamp - a.timestamp)
  return records
}

async function saveTokenDataLocal(data: TokenUsageRecord[]): Promise<void> {
  if (!DATA_PATH) return
  try {
    ensureDirExists(dirname(DATA_PATH))
    await writeFile(DATA_PATH, JSON.stringify(data, null, 2))
  } catch {
    // ignore on Vercel where filesystem is read-only
  }
}

function filterByTimeframe(records: TokenUsageRecord[], timeframe: string): TokenUsageRecord[] {
  const now = Date.now()
  let cutoffTime: number

  switch (timeframe) {
    case 'hour': cutoffTime = now - 60 * 60 * 1000; break
    case 'day': cutoffTime = now - 24 * 60 * 60 * 1000; break
    case 'week': cutoffTime = now - 7 * 24 * 60 * 60 * 1000; break
    case 'month': cutoffTime = now - 30 * 24 * 60 * 60 * 1000; break
    case 'all': default: return records
  }

  return records.filter(record => record.timestamp >= cutoffTime)
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function calculateStats(records: TokenUsageRecord[]): TokenStats {
  if (records.length === 0) {
    return { totalTokens: 0, totalCost: 0, requestCount: 0, avgTokensPerRequest: 0, avgCostPerRequest: 0 }
  }

  const totalTokens = records.reduce((sum, r) => sum + r.totalTokens, 0)
  const totalCost = records.reduce((sum, r) => sum + r.cost, 0)
  const requestCount = records.length

  return {
    totalTokens,
    totalCost,
    requestCount,
    avgTokensPerRequest: Math.round(totalTokens / requestCount),
    avgCostPerRequest: totalCost / requestCount,
  }
}

// ---------------------------------------------------------------------------
// GET /api/tokens
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'list'
    const timeframe = searchParams.get('timeframe') || 'all'
    const format = searchParams.get('format') || 'json'

    // loadTokenData handles timeframe filtering for Neon path
    const { records: filteredData, source } = await loadTokenData(timeframe)

    if (action === 'list') {
      return NextResponse.json({
        usage: filteredData.slice(0, 100),
        total: filteredData.length,
        timeframe,
        source,
      })
    }

    if (action === 'stats') {
      const overallStats = calculateStats(filteredData)

      const modelGroups = filteredData.reduce((acc, r) => {
        if (!acc[r.model]) acc[r.model] = []
        acc[r.model].push(r)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)

      const modelStats: Record<string, TokenStats> = {}
      for (const [model, records] of Object.entries(modelGroups)) {
        modelStats[model] = calculateStats(records)
      }

      const sessionGroups = filteredData.reduce((acc, r) => {
        if (!acc[r.sessionId]) acc[r.sessionId] = []
        acc[r.sessionId].push(r)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)

      const sessionStats: Record<string, TokenStats> = {}
      for (const [sessionId, records] of Object.entries(sessionGroups)) {
        sessionStats[sessionId] = calculateStats(records)
      }

      const providerGroups = filteredData.reduce((acc, r) => {
        const provider = getProviderFromModel(r.model)
        if (!acc[provider]) acc[provider] = []
        acc[provider].push(r)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)

      const providerStats: Record<string, TokenStats> = {}
      for (const [provider, records] of Object.entries(providerGroups)) {
        providerStats[provider] = calculateStats(records)
      }

      return NextResponse.json({
        summary: overallStats,
        models: modelStats,
        sessions: sessionStats,
        providers: providerStats,
        timeframe,
        recordCount: filteredData.length,
        source,
      })
    }

    if (action === 'trends') {
      const hourlyTrends: Record<string, { tokens: number; cost: number; requests: number }> = {}

      filteredData.forEach(record => {
        const hour = new Date(record.timestamp).toISOString().slice(0, 13) + ':00:00.000Z'
        if (!hourlyTrends[hour]) hourlyTrends[hour] = { tokens: 0, cost: 0, requests: 0 }
        hourlyTrends[hour].tokens += record.totalTokens
        hourlyTrends[hour].cost += record.cost
        hourlyTrends[hour].requests += 1
      })

      const trends = Object.entries(hourlyTrends)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([timestamp, data]) => ({ timestamp, ...data }))

      return NextResponse.json({ trends, timeframe, source })
    }

    if (action === 'export') {
      const overallStats = calculateStats(filteredData)

      const modelGroups = filteredData.reduce((acc, r) => {
        if (!acc[r.model]) acc[r.model] = []
        acc[r.model].push(r)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)

      const modelStats: Record<string, TokenStats> = {}
      for (const [model, records] of Object.entries(modelGroups)) {
        modelStats[model] = calculateStats(records)
      }

      const sessionGroups = filteredData.reduce((acc, r) => {
        if (!acc[r.sessionId]) acc[r.sessionId] = []
        acc[r.sessionId].push(r)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)

      const sessionStats: Record<string, TokenStats> = {}
      for (const [sessionId, records] of Object.entries(sessionGroups)) {
        sessionStats[sessionId] = calculateStats(records)
      }

      const providerGroups = filteredData.reduce((acc, r) => {
        const provider = getProviderFromModel(r.model)
        if (!acc[provider]) acc[provider] = []
        acc[provider].push(r)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)

      const providerStats: Record<string, TokenStats> = {}
      for (const [provider, records] of Object.entries(providerGroups)) {
        providerStats[provider] = calculateStats(records)
      }

      const exportData: ExportData = {
        usage: filteredData,
        summary: overallStats,
        models: modelStats,
        sessions: sessionStats,
        providers: providerStats,
      }

      if (format === 'csv') {
        const headers = ['timestamp', 'model', 'sessionId', 'operation', 'inputTokens', 'outputTokens', 'totalTokens', 'cost', 'duration']
        const csvRows = [headers.join(',')]
        filteredData.forEach(record => {
          csvRows.push([
            new Date(record.timestamp).toISOString(),
            record.model,
            record.sessionId,
            record.operation,
            record.inputTokens,
            record.outputTokens,
            record.totalTokens,
            record.cost.toFixed(4),
            record.duration || 0,
          ].join(','))
        })

        return new NextResponse(csvRows.join('\n'), {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename=token-usage-${timeframe}-${new Date().toISOString().split('T')[0]}.csv`,
          },
        })
      }

      return NextResponse.json(exportData, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename=token-usage-${timeframe}-${new Date().toISOString().split('T')[0]}.json`,
        },
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Tokens API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/tokens — ingest a token usage record
// Writes to Neon DB first; falls back to local file in dev.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { model, sessionId, inputTokens, outputTokens, operation = 'chat_completion', duration, agentName, taskId } = body

    if (!model || !sessionId || typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
      return NextResponse.json({ error: 'Missing required fields: model, sessionId, inputTokens, outputTokens' }, { status: 400 })
    }

    const totalTokens = inputTokens + outputTokens
    const costPer1k = getModelCost(model)
    const cost = (totalTokens / 1000) * costPer1k
    const now = Math.floor(Date.now() / 1000)

    // Write to Neon DB
    try {
      const [inserted] = await db.insert(tokenUsage).values({
        model,
        session_id: sessionId,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: cost,
        agent_name: agentName || null,
        task_id: taskId || null,
        workspace_id: 1,
        created_at: now,
      }).returning({ id: tokenUsage.id })

      return NextResponse.json({ success: true, id: inserted.id, source: 'neon' })
    } catch (dbErr) {
      console.warn('[tokens POST] Neon write failed, falling back to local file:', (dbErr as Error).message)
    }

    // Local file fallback
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      model,
      sessionId,
      timestamp: Date.now(),
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      operation,
      duration,
    }

    try {
      const { records: existingData } = await loadTokenData('all')
      existingData.unshift(record)
      if (existingData.length > 10000) existingData.splice(10000)
      await saveTokenDataLocal(existingData)
    } catch {
      // ignore file write failures on Vercel
    }

    return NextResponse.json({ success: true, record, source: 'file' })
  } catch (error) {
    console.error('Error saving token usage:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
