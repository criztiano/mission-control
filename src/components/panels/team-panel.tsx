'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@/components/ui/button'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { Refresh, Xmark, FloppyDisk } from 'iconoir-react'
import { useSmartPoll } from '@/lib/use-smart-poll'

// --- Types ---

interface ManifestAgent {
  id: string
  workspace: string
  config: {
    model: string | { primary: string; fallbacks?: string[] }
    skills: string[]
    tools: Record<string, any>
    heartbeat: Record<string, any>
    subagents: { allowAgents?: string[] }
  }
  identity: {
    name: string
    emoji: string
    goal: string
    reports_to: string
    sub_agents: string[]
  }
  docs: { version: number; updated: string }
  duties: string[]
  policies: string[]
  channels: { channel: string; purpose: string }[]
  references: string[]
  crons?: { id: string; name: string; schedule: any; enabled: boolean }[]
  discord?: { bot_name: string; account_key: string }
  live: {
    status: string
    last_seen: number | null
    last_activity: string | null
  }
}

interface Relationship {
  from: string
  to: string
  label?: string
}

interface TeamManifest {
  _meta: { generated_at: string; generator: string; version: number }
  hierarchy: Record<string, string[]>
  agent_to_agent: { allow?: string[] }
  relationships: { hierarchy: Relationship[]; comms: Relationship[] }
  agents: ManifestAgent[]
}

// --- Helpers ---

function getModelShort(model: string | { primary: string; fallbacks?: string[] }): string {
  const raw = typeof model === 'string' ? model : model.primary
  // Strip provider prefix (anthropic/, openrouter/, etc.)
  const parts = raw.split('/')
  return parts[parts.length - 1]
}

function getModelFallbacks(model: string | { primary: string; fallbacks?: string[] }): string[] {
  if (typeof model === 'string') return []
  return (model.fallbacks || []).map((f) => {
    const parts = f.split('/')
    return parts[parts.length - 1]
  })
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'never'
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function statusDotColor(status: string): string {
  switch (status) {
    case 'idle': return 'bg-green-500'
    case 'busy': return 'bg-yellow-500'
    case 'error': return 'bg-red-500'
    default: return 'bg-zinc-500'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'idle': return 'Online'
    case 'busy': return 'Busy'
    case 'error': return 'Error'
    default: return 'Offline'
  }
}

// --- Custom Node ---

type AgentNodeData = {
  agent: ManifestAgent
  onSelect: (agent: ManifestAgent) => void
  selected: boolean
}

function TeamAgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const { agent, onSelect, selected } = data
  const name = agent.identity.name || agent.id
  const emoji = agent.identity.emoji
  const goal = agent.identity.goal
  const model = getModelShort(agent.config.model)
  const status = agent.live.status
  const lastSeen = timeAgo(agent.live.last_seen)

  return (
    <div
      className={`cursor-pointer transition-all duration-150 rounded-xl border-2 bg-card shadow-lg min-w-[180px] max-w-[220px] ${
        selected
          ? 'border-primary ring-2 ring-primary/20'
          : 'border-border hover:border-primary/40'
      }`}
      onClick={() => onSelect(agent)}
    >
      <Handle type="target" position={Position.Top} className="!bg-border !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-border !w-2 !h-2 !border-0" />

      <div className="p-3">
        {/* Header: emoji + name + status dot */}
        <div className="flex items-center gap-2 mb-1.5">
          {emoji ? (
            <span className="text-lg leading-none shrink-0">{emoji}</span>
          ) : (
            <AgentAvatar agent={name} size="sm" />
          )}
          <span className="text-sm font-semibold text-foreground truncate flex-1">{name}</span>
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDotColor(status)}`}
            title={statusLabel(status)}
          />
        </div>

        {/* Goal (one-line truncated) */}
        {goal && (
          <p className="text-[11px] text-muted-foreground truncate mb-2 leading-tight">{goal}</p>
        )}

        {/* Model badge + last active */}
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground truncate">
            {model}
          </span>
          <span className="text-[10px] text-muted-foreground/60 shrink-0">{lastSeen}</span>
        </div>
      </div>
    </div>
  )
}

const nodeTypes = { teamAgent: TeamAgentNode }

// --- Layout Helpers ---

function buildNodesAndEdges(
  manifest: TeamManifest,
  selectedId: string | null,
  onSelect: (a: ManifestAgent) => void
) {
  const agents = manifest.agents
  const rels = manifest.relationships || { hierarchy: [], comms: [] }
  const nodes: Node<AgentNodeData>[] = []
  const edges: Edge[] = []
  const agentIds = new Set(agents.map((a) => a.id))

  // Build tier layout from hierarchy relationships
  // Tier 0: agents that report to 'cri' (top level)
  // Tier 1: agents that report to tier 0 agents
  // Tier 2: agents that report to tier 1 agents
  const reportsTo = new Map<string, string>() // child -> parent
  for (const rel of rels.hierarchy) {
    if (agentIds.has(rel.from) && rel.to !== 'cri') {
      reportsTo.set(rel.from, rel.to)
    }
  }

  const tier0: string[] = [] // reports to cri
  const tier1: string[] = [] // reports to tier0
  const tier2: string[] = [] // reports to tier1

  // First pass: find tier 0 (reports to cri)
  for (const rel of rels.hierarchy) {
    if (rel.to === 'cri' && agentIds.has(rel.from)) {
      tier0.push(rel.from)
    }
  }

  // Second pass: find tier 1 (reports to tier0)
  const tier0Set = new Set(tier0)
  for (const [child, parent] of reportsTo) {
    if (tier0Set.has(parent) && !tier0Set.has(child)) {
      tier1.push(child)
    }
  }

  // Third pass: find tier 2 (reports to tier1)
  const tier1Set = new Set(tier1)
  for (const [child, parent] of reportsTo) {
    if (tier1Set.has(parent) && !tier0Set.has(child) && !tier1Set.has(child)) {
      tier2.push(child)
    }
  }

  // Any unplaced agents go to tier 1
  const placed = new Set([...tier0, ...tier1, ...tier2])
  for (const agent of agents) {
    if (!placed.has(agent.id)) {
      tier1.push(agent.id)
    }
  }

  const CARD_W = 200
  const X_GAP = 50
  const Y_GAP = 160

  // Position tier 0 (top, centered)
  const t0StartX = -((tier0.length - 1) * (CARD_W + X_GAP)) / 2
  tier0.forEach((id, i) => {
    const agent = agents.find((a) => a.id === id)!
    nodes.push({
      id,
      type: 'teamAgent',
      position: { x: t0StartX + i * (CARD_W + X_GAP), y: 0 },
      data: { agent, onSelect, selected: selectedId === id },
    })
  })

  // Position tier 1 (middle row)
  const t1StartX = -((tier1.length - 1) * (CARD_W + X_GAP)) / 2
  tier1.forEach((id, i) => {
    const agent = agents.find((a) => a.id === id)!
    nodes.push({
      id,
      type: 'teamAgent',
      position: { x: t1StartX + i * (CARD_W + X_GAP), y: Y_GAP },
      data: { agent, onSelect, selected: selectedId === id },
    })
  })

  // Position tier 2 (bottom row)
  const t2StartX = -((tier2.length - 1) * (CARD_W + X_GAP)) / 2
  tier2.forEach((id, i) => {
    const agent = agents.find((a) => a.id === id)!
    nodes.push({
      id,
      type: 'teamAgent',
      position: { x: t2StartX + i * (CARD_W + X_GAP), y: Y_GAP * 2 },
      data: { agent, onSelect, selected: selectedId === id },
    })
  })

  // Edges: hierarchy (solid, arrow) — drawn parent→child (top-down)
  for (const rel of rels.hierarchy) {
    if (rel.to === 'cri') continue // skip the cri node (not in graph)
    if (!agentIds.has(rel.from) || !agentIds.has(rel.to)) continue
    edges.push({
      id: `hier-${rel.from}-${rel.to}`,
      source: rel.to,
      target: rel.from,
      type: 'default',
      animated: false,
      style: {
        stroke: 'hsl(var(--muted-foreground))',
        strokeWidth: 2,
      },
      markerEnd: {
        type: 'arrowclosed' as any,
        color: 'hsl(var(--muted-foreground))',
      },
      label: rel.label && rel.label !== 'reports to' ? rel.label : undefined,
      labelStyle: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' },
    })
  }

  // Edges: comms (dashed blue, or faint for shared resources)
  for (const rel of rels.comms) {
    if (!agentIds.has(rel.from) || !agentIds.has(rel.to)) continue
    const isFaint = (rel as any).style === 'faint'
    edges.push({
      id: `comms-${rel.from}-${rel.to}`,
      source: rel.from,
      target: rel.to,
      type: 'default',
      style: isFaint
        ? { stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }
        : { stroke: '#3b82f6', strokeWidth: 1.5, strokeDasharray: '6,4' },
      label: rel.label || undefined,
      labelStyle: isFaint
        ? { fontSize: 0 }
        : { fontSize: 10, fill: '#3b82f6' },
    })
  }

  return { nodes, edges }
}

// --- Detail Panel ---

function AccordionSection({
  title,
  children,
  defaultOpen = true,
  count,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  count?: number
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-secondary/50 transition-colors"
      >
        <span className="text-xs font-semibold text-foreground">{title}</span>
        <div className="flex items-center gap-2">
          {count !== undefined && (
            <span className="text-[10px] text-muted-foreground font-mono">{count}</span>
          )}
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`w-3 h-3 text-muted-foreground transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
          >
            <polyline points="4,6 8,10 12,6" />
          </svg>
        </div>
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  )
}

// Full-panel skill browser (slides in from right)
function SkillBrowser({
  allSkills,
  activeSkills,
  onToggle,
  onClose,
}: {
  allSkills: string[]
  activeSkills: string[]
  onToggle: (skill: string, enabled: boolean) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const activeSet = new Set(activeSkills)
  const filtered = search
    ? allSkills.filter((s) => s.toLowerCase().includes(search.toLowerCase()))
    : allSkills

  // Group skills by first letter
  const groups = new Map<string, string[]>()
  for (const s of filtered) {
    const letter = s[0].toUpperCase()
    if (!groups.has(letter)) groups.set(letter, [])
    groups.get(letter)!.push(s)
  }

  return (
    <div
      className="absolute inset-0 z-10 bg-card flex flex-col"
      style={{ animation: 'slideInRight 0.2s ease-out' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border shrink-0">
        <Button variant="ghost" size="icon-xs" onClick={onClose} title="Back">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M10 3l-5 5 5 5" />
          </svg>
        </Button>
        <h3 className="text-sm font-bold text-foreground">Skills</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {activeSkills.length} active / {allSkills.length} available
        </span>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          className="text-xs font-mono px-2.5 py-1.5 rounded border border-border bg-secondary text-foreground w-full outline-none focus:border-primary"
          placeholder="Search skills..."
        />
      </div>

      {/* Skill list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {Array.from(groups.entries()).map(([letter, skills]) => (
          <div key={letter} className="mb-3">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{letter}</div>
            <div className="space-y-0.5">
              {skills.map((skill) => {
                const active = activeSet.has(skill)
                return (
                  <button
                    key={skill}
                    onClick={() => onToggle(skill, !active)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-left transition-colors ${
                      active
                        ? 'bg-blue-500/10 hover:bg-blue-500/15'
                        : 'hover:bg-secondary/50'
                    }`}
                  >
                    <span className={`text-[11px] font-mono ${active ? 'text-blue-400' : 'text-muted-foreground'}`}>
                      {skill}
                    </span>
                    <div className={`w-7 h-4 rounded-full transition-colors flex items-center ${
                      active ? 'bg-blue-500 justify-end' : 'bg-zinc-700 justify-start'
                    }`}>
                      <div className={`w-3 h-3 rounded-full mx-0.5 transition-colors ${
                        active ? 'bg-white' : 'bg-zinc-500'
                      }`} />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No skills matching "{search}"</p>
        )}
      </div>
    </div>
  )
}

// Toggleable tool badges — all tools shown, active vs denied
function ToolToggles({
  allTools,
  denyList,
  alsoAllow,
  onToggleDeny,
  onToggleAllow,
}: {
  allTools: string[]
  denyList: string[]
  alsoAllow: string[]
  onToggleDeny: (tool: string, denied: boolean) => void
  onToggleAllow: (tool: string, allowed: boolean) => void
}) {
  const denySet = new Set(denyList)
  const allowSet = new Set(alsoAllow)

  // Extra tools aren't in the default set — they need alsoAllow to be enabled
  const extraTools = ['browser', 'canvas', 'tts', 'nodes', 'gateway']
  const standardTools = allTools.filter((t) => !extraTools.includes(t))

  // If agent has NO deny list AND NO alsoAllow, they have full access (main agent)
  const hasFullAccess = denyList.length === 0 && alsoAllow.length === 0

  return (
    <div className="space-y-2">
      {hasFullAccess && (
        <p className="text-[10px] text-muted-foreground italic">Full access — all tools enabled</p>
      )}
      <div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Standard</span>
        <div className="flex flex-wrap gap-1 mt-1">
          {standardTools.map((tool) => {
            const denied = denySet.has(tool)
            return (
              <button
                key={tool}
                onClick={() => onToggleDeny(tool, !denied)}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-all cursor-pointer ${
                  denied
                    ? 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20 line-through opacity-50'
                    : 'bg-green-500/10 text-green-400 border-green-500/20'
                }`}
                title={denied ? `Enable ${tool}` : `Disable ${tool}`}
              >
                {tool}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Extra</span>
        <div className="flex flex-wrap gap-1 mt-1">
          {extraTools.map((tool) => {
            const denied = denySet.has(tool)
            // Active if: full access and not denied, OR explicitly in alsoAllow and not denied
            const active = (!denied) && (hasFullAccess || allowSet.has(tool))
            return (
              <button
                key={tool}
                onClick={() => {
                  if (hasFullAccess) {
                    // For full-access agents, toggling off means adding to deny
                    onToggleDeny(tool, !denied)
                  } else {
                    // For restricted agents, toggle alsoAllow
                    onToggleAllow(tool, !active)
                  }
                }}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-all cursor-pointer ${
                  active
                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20 opacity-50'
                }`}
                title={active ? `Disable ${tool}` : `Enable ${tool}`}
              >
                {tool}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AgentDetailSlideout({
  agent,
  onClose,
  onRefresh,
}: {
  agent: ManifestAgent
  onClose: () => void
  onRefresh: () => void
}) {
  const name = agent.identity.name || agent.id
  const emoji = agent.identity.emoji
  const goal = agent.identity.goal
  const model = getModelShort(agent.config.model)
  const fullModel = typeof agent.config.model === 'string' ? agent.config.model : (agent.config.model as any).primary || ''
  const fallbacks = getModelFallbacks(agent.config.model)
  const status = agent.live.status
  const skills = agent.config.skills || []
  const toolsDeny = agent.config.tools?.deny || []
  const toolsAllow = agent.config.tools?.alsoAllow || []
  const duties = agent.duties || []
  const policies = agent.policies || []
  const channels = agent.channels || []
  const crons = agent.crons || []
  const heartbeat = agent.config.heartbeat || {}
  const subagents = agent.config.subagents?.allowAgents || []
  const [saving, setSaving] = useState(false)

  const updateAgent = useCallback(async (field: string, value: any) => {
    setSaving(true)
    try {
      const res = await fetch('/api/team/agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, field, value }),
      })
      if (res.ok) {
        onRefresh()
      }
    } catch {}
    setSaving(false)
  }, [agent.id, onRefresh])

  // Catalog (all available skills/tools)
  const [catalog, setCatalog] = useState<{ tools: string[]; skills: string[] }>({ tools: [], skills: [] })
  useEffect(() => {
    fetch('/api/team/catalog')
      .then((r) => r.ok ? r.json() : { tools: [], skills: [] })
      .then(setCatalog)
      .catch(() => {})
  }, [])

  // Skill browser
  const [skillBrowserOpen, setSkillBrowserOpen] = useState(false)

  // Editable model state
  const [editingModel, setEditingModel] = useState(false)
  const [modelDraft, setModelDraft] = useState(fullModel)

  return (
    <div className="w-[380px] h-full bg-card border-l border-border flex flex-col shrink-0 shadow-xl relative overflow-hidden">
      {/* Skill browser overlay */}
      {skillBrowserOpen && (
        <SkillBrowser
          allSkills={catalog.skills}
          activeSkills={skills}
          onToggle={(skill, enabled) => {
            const newSkills = enabled
              ? [...skills, skill]
              : skills.filter((s) => s !== skill)
            updateAgent('skills', newSkills)
          }}
          onClose={() => setSkillBrowserOpen(false)}
        />
      )}
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {emoji ? (
            <span className="text-2xl leading-none shrink-0">{emoji}</span>
          ) : (
            <AgentAvatar agent={name} size="sm" />
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground truncate">{name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-2 h-2 rounded-full ${statusDotColor(status)}`} />
              <span className="text-[11px] text-muted-foreground">{statusLabel(status)}</span>
              <span className="text-[11px] text-muted-foreground/50 mx-1">|</span>
              <span className="text-[11px] text-muted-foreground">{timeAgo(agent.live.last_seen)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {saving && <span className="text-[10px] text-primary animate-pulse">saving...</span>}
          <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
            <Xmark className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Identity */}
        <AccordionSection title="Identity" defaultOpen>
          <div className="space-y-2">
            {goal && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Goal</span>
                <p className="text-xs text-foreground mt-0.5">{goal}</p>
              </div>
            )}
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">ID</span>
              <p className="text-xs text-foreground font-mono mt-0.5">{agent.id}</p>
            </div>
            {agent.identity.reports_to && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Reports To</span>
                <p className="text-xs text-foreground mt-0.5">{agent.identity.reports_to}</p>
              </div>
            )}
          </div>
        </AccordionSection>

        {/* Duties */}
        {duties.length > 0 && (
          <AccordionSection title="Duties" count={duties.length}>
            <ul className="space-y-1">
              {duties.map((d, i) => (
                <li key={i} className="text-xs text-foreground flex gap-1.5">
                  <span className="text-muted-foreground shrink-0">-</span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </AccordionSection>
        )}

        {/* Policies */}
        {policies.length > 0 && (
          <AccordionSection title="Policies" count={policies.length}>
            <ul className="space-y-1">
              {policies.map((p, i) => (
                <li key={i} className="text-xs text-foreground flex gap-1.5">
                  <span className="text-muted-foreground shrink-0">-</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </AccordionSection>
        )}

        {/* Tools */}
        <AccordionSection title="Tools" defaultOpen>
          <ToolToggles
            allTools={catalog.tools}
            denyList={toolsDeny}
            alsoAllow={toolsAllow}
            onToggleDeny={(tool, denied) => {
              const newDeny = denied
                ? [...toolsDeny, tool]
                : toolsDeny.filter((t: string) => t !== tool)
              updateAgent('tools.deny', newDeny)
            }}
            onToggleAllow={(tool, allowed) => {
              const newAllow = allowed
                ? [...toolsAllow, tool]
                : toolsAllow.filter((t: string) => t !== tool)
              updateAgent('tools.alsoAllow', newAllow)
            }}
          />
        </AccordionSection>

        {/* Skills */}
        <AccordionSection title="Skills" count={skills.length > 0 ? skills.length : catalog.skills.length} defaultOpen>
          <div className="space-y-2">
            {skills.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic mb-1">
                Auto-discovery — all {catalog.skills.length} skills available
              </p>
            )}
            <div className="flex flex-wrap gap-1">
              {skills.map((s) => (
                <span
                  key={s}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 group cursor-default flex items-center gap-1"
                >
                  {s}
                  <button
                    onClick={() => updateAgent('skills', skills.filter((x) => x !== s))}
                    className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                    title={`Remove ${s}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button
              onClick={() => setSkillBrowserOpen(true)}
              className="text-[10px] font-mono px-2 py-1 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
            >
              Browse & manage skills →
            </button>
          </div>
        </AccordionSection>

        {/* Channels */}
        {channels.length > 0 && (
          <AccordionSection title="Channels" count={channels.length}>
            <div className="space-y-1.5">
              {channels.map((ch, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
                    {ch.channel}
                  </span>
                  {ch.purpose && (
                    <span className="text-[11px] text-muted-foreground">{ch.purpose}</span>
                  )}
                </div>
              ))}
            </div>
          </AccordionSection>
        )}

        {/* Crons */}
        {crons.length > 0 && (
          <AccordionSection title="Crons" count={crons.length}>
            <div className="space-y-2">
              {crons.map((cron) => (
                <div key={cron.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-foreground truncate">{cron.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">
                      {typeof cron.schedule === 'object' ? cron.schedule.expr : cron.schedule}
                      {cron.schedule?.tz && <span className="text-muted-foreground/50 ml-1">({cron.schedule.tz})</span>}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                      cron.enabled
                        ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                        : 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20'
                    }`}
                  >
                    {cron.enabled ? 'on' : 'off'}
                  </span>
                </div>
              ))}
            </div>
          </AccordionSection>
        )}

        {/* Config */}
        <AccordionSection title="Config">
          <div className="space-y-2">
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Model</span>
              {editingModel ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (modelDraft.trim()) {
                      const newModel = typeof agent.config.model === 'string'
                        ? modelDraft.trim()
                        : { ...(agent.config.model as any), primary: modelDraft.trim() }
                      updateAgent('model', newModel)
                      setEditingModel(false)
                    }
                  }}
                  className="mt-0.5"
                >
                  <input
                    type="text"
                    value={modelDraft}
                    onChange={(e) => setModelDraft(e.target.value)}
                    autoFocus
                    onBlur={() => setEditingModel(false)}
                    className="text-xs font-mono px-2 py-1 rounded border border-border bg-secondary text-foreground w-full outline-none focus:border-primary"
                  />
                </form>
              ) : (
                <p
                  className="text-xs font-mono text-foreground mt-0.5 cursor-pointer hover:text-primary transition-colors"
                  onClick={() => { setModelDraft(fullModel); setEditingModel(true) }}
                  title="Click to edit"
                >
                  {fullModel || model} ✎
                </p>
              )}
            </div>
            {fallbacks.length > 0 && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Fallbacks</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {fallbacks.map((f) => (
                    <span key={f} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(heartbeat).length > 0 && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Heartbeat</span>
                <p className="text-xs font-mono text-foreground mt-0.5">
                  {heartbeat.every || 'default'}
                  {heartbeat.lightContext && ' (light)'}
                </p>
              </div>
            )}
            {subagents.length > 0 && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Can Spawn</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {subagents.map((s: string) => (
                    <span key={s} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Workspace</span>
              <p className="text-[11px] font-mono text-muted-foreground mt-0.5 break-all">{agent.workspace}</p>
            </div>
          </div>
        </AccordionSection>

        {/* Live Stats */}
        <AccordionSection title="Live Status" defaultOpen>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-secondary/50 rounded-lg p-2.5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</span>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`w-2 h-2 rounded-full ${statusDotColor(status)}`} />
                <span className="text-xs font-medium text-foreground">{statusLabel(status)}</span>
              </div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-2.5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Last Active</span>
              <p className="text-xs font-medium text-foreground mt-1">{timeAgo(agent.live.last_seen)}</p>
            </div>
          </div>
        </AccordionSection>
      </div>
    </div>
  )
}

// --- Main Panel ---

export function TeamPanel() {
  const [manifest, setManifest] = useState<TeamManifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<ManifestAgent | null>(null)
  const [savedPositions, setSavedPositions] = useState<Record<string, { x: number; y: number }> | null>(null)
  const [positionsDirty, setPositionsDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Fetch saved positions
  useEffect(() => {
    fetch('/api/team/positions')
      .then((r) => r.ok ? r.json() : { positions: {} })
      .then((d) => setSavedPositions(d.positions || {}))
      .catch(() => setSavedPositions({}))
  }, [])

  const fetchManifest = useCallback(async () => {
    try {
      const res = await fetch('/api/team/manifest')
      if (!res.ok) throw new Error('Failed to load manifest')
      const data: TeamManifest = await res.json()
      setManifest(data)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchManifest()
  }, [fetchManifest])

  useSmartPoll(fetchManifest, 30000)

  // Track node position changes
  const handleNodesChange = useCallback((changes: any) => {
    onNodesChange(changes)
    // Mark dirty if any position change
    if (changes.some((c: any) => c.type === 'position' && c.position)) {
      setPositionsDirty(true)
    }
  }, [onNodesChange])

  // Save positions
  const savePositions = useCallback(async () => {
    setSaving(true)
    const positions: Record<string, { x: number; y: number }> = {}
    for (const node of nodes) {
      positions[node.id] = { x: node.position.x, y: node.position.y }
    }
    try {
      await fetch('/api/team/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions }),
      })
      setSavedPositions(positions)
      setPositionsDirty(false)
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }, [nodes])

  // Build graph when manifest or selection changes
  useEffect(() => {
    if (!manifest || savedPositions === null) return
    const { nodes: n, edges: e } = buildNodesAndEdges(
      manifest,
      selectedAgent?.id || null,
      (agent) => setSelectedAgent(agent)
    )
    // Apply saved positions if available
    const positioned = n.map((node) => {
      const saved = savedPositions[node.id]
      if (saved) {
        return { ...node, position: { x: saved.x, y: saved.y } }
      }
      return node
    })
    setNodes(positioned)
    setEdges(e)
  }, [manifest, selectedAgent?.id, savedPositions, setNodes, setEdges])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-sm text-muted-foreground">Loading team manifest...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-400 mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchManifest}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column' }}>
      {/* Fixed header */}
      <div className="flex justify-between items-center p-4 border-b border-border" style={{ flexShrink: 0 }}>
        <div>
          <h2 className="text-xl font-bold text-foreground">Team</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {manifest?.agents.length || 0} agents
            {manifest?._meta?.generated_at && (
              <span className="text-muted-foreground/50 ml-2">
                manifest {new Date(manifest._meta.generated_at).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {positionsDirty && (
            <Button
              variant="outline"
              size="sm"
              onClick={savePositions}
              disabled={saving}
              title="Save positions"
              className="gap-1.5"
            >
              <FloppyDisk className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save layout'}
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={fetchManifest} title="Refresh">
            <Refresh className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content: Tree + optional detail */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Flow canvas */}
        <div style={{ flex: 1, position: 'relative' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            minZoom={0.3}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
            className="bg-background"
          >
            <Controls
              style={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            />
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="hsl(var(--muted-foreground))"
              style={{ opacity: 0.15 }}
            />
          </ReactFlow>

          {/* Legend */}
          <div className="absolute bottom-16 left-4 bg-card/90 backdrop-blur-sm border border-border rounded-lg p-2.5 text-[10px] space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-5 h-0 border-t-2 border-muted-foreground" />
              <span className="text-muted-foreground">Reports to</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-0 border-t-[1.5px] border-dashed border-blue-500" />
              <span className="text-muted-foreground">Comms / Delegates</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <span className="text-muted-foreground">Online</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
              <span className="text-muted-foreground">Busy</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
              <span className="text-muted-foreground">Offline</span>
            </div>
          </div>
        </div>

        {/* Detail slideout */}
        {selectedAgent && (
          <AgentDetailSlideout
            key={selectedAgent.id}
            agent={selectedAgent}
            onClose={() => setSelectedAgent(null)}
            onRefresh={fetchManifest}
          />
        )}
      </div>
    </div>
  )
}
