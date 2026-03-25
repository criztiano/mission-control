/**
 * Agent Config Sync
 *
 * Reads agents from openclaw.json and upserts them into the MC database.
 * Used by both the /api/agents/sync endpoint and the startup scheduler.
 */

import { config } from './config'
import { db_helpers, logAuditEvent } from './db'
import { db } from '@/db/client'
import { agents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { eventBus } from './event-bus'
import { join } from 'path'
import { readWorkspaceFile } from './agent-workspace'

interface OpenClawAgent {
  id: string
  name?: string
  default?: boolean
  workspace?: string
  agentDir?: string
  model?: {
    primary?: string
    fallbacks?: string[]
  }
  identity?: {
    name?: string
    theme?: string
    emoji?: string
  }
  subagents?: any
  sandbox?: {
    mode?: string
    workspaceAccess?: string
    scope?: string
    docker?: any
  }
  tools?: {
    allow?: string[]
    deny?: string[]
  }
  memorySearch?: any
  heartbeat?: {
    every?: string
  }
}

export interface SyncResult {
  synced: number
  created: number
  updated: number
  agents: Array<{
    id: string
    name: string
    action: 'created' | 'updated' | 'unchanged'
  }>
  error?: string
}

export interface SyncDiff {
  inConfig: number
  inMC: number
  newAgents: string[]
  updatedAgents: string[]
  onlyInMC: string[]
}

function getConfigPath(): string | null {
  if (!config.openclawHome) return null
  return join(config.openclawHome, 'openclaw.json')
}

/** Read and parse openclaw.json agents list */
async function readOpenClawAgents(): Promise<OpenClawAgent[]> {
  const configPath = getConfigPath()
  if (!configPath) throw new Error('OPENCLAW_HOME not configured')

  const { readFile } = require('fs/promises')
  const raw = await readFile(configPath, 'utf-8')
  const parsed = JSON.parse(raw)
  return parsed?.agents?.list || []
}

/** Extract MC-friendly fields from an OpenClaw agent config */
function mapAgentToMC(agent: OpenClawAgent): {
  name: string
  role: string
  config: any
} {
  const name = agent.identity?.name || agent.name || agent.id
  const role = agent.identity?.theme || 'agent'

  const configData = {
    openclawId: agent.id,
    model: agent.model,
    identity: agent.identity,
    sandbox: agent.sandbox,
    tools: agent.tools,
    subagents: agent.subagents,
    memorySearch: agent.memorySearch,
    workspace: agent.workspace,
    agentDir: agent.agentDir,
    isDefault: agent.default || false,
    heartbeat: agent.heartbeat,
  }

  return { name, role, config: configData }
}

/** Sync agents from openclaw.json into the MC database */
export async function syncAgentsFromConfig(actor: string = 'system'): Promise<SyncResult> {
  let agentList: OpenClawAgent[]
  try {
    agentList = await readOpenClawAgents()
  } catch (err: any) {
    return { synced: 0, created: 0, updated: 0, agents: [], error: err.message }
  }

  if (agentList.length === 0) {
    return { synced: 0, created: 0, updated: 0, agents: [] }
  }

  const now = Math.floor(Date.now() / 1000)
  let created = 0
  let updated = 0
  const results: SyncResult['agents'] = []

  for (const agent of agentList) {
    const mapped = mapAgentToMC(agent)
    const configJson = JSON.stringify(mapped.config)

    const existingRows = await db
      .select({ id: agents.id, name: agents.name, role: agents.role, config: agents.config })
      .from(agents)
      .where(eq(agents.name, mapped.name))
      .limit(1)
    const existing = existingRows[0]

    if (existing) {
      const existingConfig = existing.config || '{}'
      if (existingConfig !== configJson || existing.role !== mapped.role) {
        await db.update(agents).set({ role: mapped.role, config: configJson, updated_at: now }).where(eq(agents.name, mapped.name))
        results.push({ id: agent.id, name: mapped.name, action: 'updated' })
        updated++
      } else {
        results.push({ id: agent.id, name: mapped.name, action: 'unchanged' })
      }
    } else {
      await db.insert(agents).values({
        name: mapped.name,
        role: mapped.role,
        status: 'offline',
        created_at: now,
        updated_at: now,
        config: configJson,
      })
      results.push({ id: agent.id, name: mapped.name, action: 'created' })
      created++
    }
  }

  // Post-sync: populate soul_content and identity from workspace files
  for (const agent of agentList) {
    const workspace = agent.workspace
    if (!workspace) continue
    const mapped = mapAgentToMC(agent)

    try {
      // Cache SOUL.md content
      const soulContent = readWorkspaceFile(workspace, 'SOUL.md')
      if (soulContent !== null) {
        await db.update(agents).set({ soul_content: soulContent }).where(eq(agents.name, mapped.name))
      }

      // Read IDENTITY.md and extract name/emoji to update display info
      const identityContent = readWorkspaceFile(workspace, 'IDENTITY.md')
      if (identityContent) {
        const nameMatch = identityContent.match(/^#\s+(.+)/m)
        const emojiMatch = identityContent.match(/emoji:\s*(.+)/i) || identityContent.match(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}])/mu)
        if (nameMatch || emojiMatch) {
          const parsedName = nameMatch?.[1]?.trim()
          const parsedEmoji = emojiMatch?.[1]?.trim()
          const rows = await db.select({ config: agents.config }).from(agents).where(eq(agents.name, mapped.name)).limit(1)
          const row = rows[0]
          if (row?.config) {
            try {
              const cfg = JSON.parse(row.config)
              if (!cfg.identity) cfg.identity = {}
              if (parsedName) cfg.identity.name = parsedName
              if (parsedEmoji) cfg.identity.emoji = parsedEmoji
              await db.update(agents).set({ config: JSON.stringify(cfg) }).where(eq(agents.name, mapped.name))
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (err) {
      console.warn(`Agent sync: failed to read workspace files for ${mapped.name}:`, err)
    }
  }

  const synced = agentList.length

  if (created > 0 || updated > 0) {
    await logAuditEvent({
      action: 'agent_config_sync',
      actor,
      detail: { synced, created, updated, agents: results.filter(a => a.action !== 'unchanged').map(a => a.name) },
    })

    eventBus.broadcast('agent.created', { type: 'sync', synced, created, updated })
  }

  console.log(`Agent sync: ${synced} total, ${created} new, ${updated} updated`)
  return { synced, created, updated, agents: results }
}

/** Preview the diff between openclaw.json and MC database without writing */
export async function previewSyncDiff(): Promise<SyncDiff> {
  let agentList: OpenClawAgent[]
  try {
    agentList = await readOpenClawAgents()
  } catch {
    return { inConfig: 0, inMC: 0, newAgents: [], updatedAgents: [], onlyInMC: [] }
  }

  const allMCAgents = await db.select({ name: agents.name, role: agents.role, config: agents.config }).from(agents)
  const mcNames = new Set(allMCAgents.map(a => a.name))

  const newAgents: string[] = []
  const updatedAgents: string[] = []
  const configNames = new Set<string>()

  for (const agent of agentList) {
    const mapped = mapAgentToMC(agent)
    configNames.add(mapped.name)

    const existing = allMCAgents.find(a => a.name === mapped.name)
    if (!existing) {
      newAgents.push(mapped.name)
    } else {
      const configJson = JSON.stringify(mapped.config)
      if (existing.config !== configJson || existing.role !== mapped.role) {
        updatedAgents.push(mapped.name)
      }
    }
  }

  const onlyInMC = allMCAgents
    .map(a => a.name)
    .filter(name => !configNames.has(name))

  return {
    inConfig: agentList.length,
    inMC: allMCAgents.length,
    newAgents,
    updatedAgents,
    onlyInMC,
  }
}

/** Write an agent config back to openclaw.json agents.list */
export async function writeAgentToConfig(agentConfig: any): Promise<void> {
  const configPath = getConfigPath()
  if (!configPath) throw new Error('OPENCLAW_HOME not configured')

  const { readFile, writeFile } = require('fs/promises')
  const raw = await readFile(configPath, 'utf-8')
  const parsed = JSON.parse(raw)

  if (!parsed.agents) parsed.agents = {}
  if (!parsed.agents.list) parsed.agents.list = []

  const idx = parsed.agents.list.findIndex((a: any) => a.id === agentConfig.id)
  if (idx >= 0) {
    parsed.agents.list[idx] = deepMerge(parsed.agents.list[idx], agentConfig)
  } else {
    parsed.agents.list.push(agentConfig)
  }

  await writeFile(configPath, JSON.stringify(parsed, null, 2) + '\n')
}

function deepMerge(target: any, source: any): any {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}
