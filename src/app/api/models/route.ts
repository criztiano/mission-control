import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { join } from 'path'

interface ModelEntry {
  id: string
  name: string
  provider: string
}

function prettyName(id: string): string {
  const map: Record<string, string> = {
    'anthropic/claude-sonnet-4-6': 'Claude Sonnet 4.6',
    'anthropic/claude-opus-4-6': 'Claude Opus 4.6',
    'openai-codex/gpt-5.4': 'GPT-5.4 Codex',
    'openai-codex/gpt-5.3-codex': 'GPT-5.3 Codex',
    'openrouter/auto': 'OpenRouter Auto',
    'openrouter/moonshotai/kimi-k2.5': 'Kimi K2.5',
    'openrouter/minimax/minimax-m2.5': 'Minimax M2.5',
    'moonshotai/kimi-k2.5': 'Kimi K2.5',
  }
  if (map[id]) return map[id]
  return id.split('/').pop()?.replace(/[-_]/g, ' ') || id
}

function providerLabel(id: string): string {
  if (id.startsWith('openrouter/')) return 'OpenRouter'
  if (id.startsWith('anthropic/')) return 'Anthropic'
  if (id.startsWith('openai-codex/')) return 'OpenAI Codex'
  if (id.startsWith('openai/')) return 'OpenAI'
  if (id.startsWith('google/')) return 'Google'
  if (id.startsWith('x-ai/')) return 'xAI'
  if (id.startsWith('minimax/')) return 'Minimax'
  if (id.startsWith('moonshotai/')) return 'Moonshot'
  if (id.startsWith('groq/')) return 'Groq'
  if (id.startsWith('ollama/')) return 'Ollama'
  if (id.startsWith('nvidia-nim/')) return 'NVIDIA NIM'
  return id.split('/')[0] || 'Other'
}

function addModel(map: Map<string, ModelEntry>, id?: string, name?: string, providerOverride?: string) {
  const value = String(id || '').trim()
  if (!value || map.has(value)) return
  map.set(value, {
    id: value,
    name: String(name || prettyName(value)),
    provider: providerOverride || providerLabel(value),
  })
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const configPath = config.openclawHome ? join(config.openclawHome, 'openclaw.json') : null
  if (!configPath) {
    return NextResponse.json({ models: [] })
  }

  try {
    const { readFile } = await import('fs/promises')
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
    const models = new Map<string, ModelEntry>()

    for (const agent of parsed?.agents?.list || []) {
      addModel(models, agent?.model)
    }

    const defaultsPrimary = parsed?.agents?.defaults?.model?.primary
    addModel(models, defaultsPrimary)

    for (const [modelId, modelCfg] of Object.entries<any>(parsed?.agents?.defaults?.models || {})) {
      addModel(models, modelId, modelCfg?.alias ? `${modelCfg.alias}` : undefined)
    }

    for (const provider of Object.values<any>(parsed?.models?.providers || {})) {
      for (const model of provider?.models || []) {
        addModel(models, model?.id, model?.name)
      }
    }

    const sorted = Array.from(models.values()).sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({ models: sorted })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load models' }, { status: 500 })
  }
}
