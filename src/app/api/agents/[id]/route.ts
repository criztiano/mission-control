import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { db_helpers, logAuditEvent } from '@/lib/db'
import { agents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFromRequest, requireRole } from '@/lib/auth'
import { writeAgentToConfig } from '@/lib/agent-sync'
import { eventBus } from '@/lib/event-bus'

/**
 * GET /api/agents/[id] - Get a single agent by ID or name
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params

    let agentRows
    if (isNaN(Number(id))) {
      agentRows = await db.select().from(agents).where(eq(agents.name, id)).limit(1)
    } else {
      agentRows = await db.select().from(agents).where(eq(agents.id, Number(id))).limit(1)
    }
    const agent = agentRows[0]

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const parsed = {
      ...agent,
      config: agent.config ? JSON.parse(agent.config) : {},
    }

    return NextResponse.json({ agent: parsed })
  } catch (error) {
    console.error('GET /api/agents/[id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch agent' }, { status: 500 })
  }
}

/**
 * PUT /api/agents/[id] - Update agent config
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await request.json()
    const { role, gateway_config, write_to_gateway } = body

    let agentRows
    if (isNaN(Number(id))) {
      agentRows = await db.select().from(agents).where(eq(agents.name, id)).limit(1)
    } else {
      agentRows = await db.select().from(agents).where(eq(agents.id, Number(id))).limit(1)
    }
    const agent = agentRows[0]

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const now = Math.floor(Date.now() / 1000)
    const existingConfig = agent.config ? JSON.parse(agent.config) : {}

    let newConfig = existingConfig
    if (gateway_config && typeof gateway_config === 'object') {
      newConfig = { ...existingConfig, ...gateway_config }
    }

    const updateData: any = { updated_at: now }
    if (role !== undefined) updateData.role = role
    if (gateway_config) updateData.config = JSON.stringify(newConfig)

    await db.update(agents).set(updateData).where(eq(agents.id, agent.id))

    if (write_to_gateway && gateway_config) {
      try {
        const openclawId = existingConfig.openclawId || agent.name.toLowerCase().replace(/\s+/g, '-')
        const writeBack: any = { id: openclawId }
        if (gateway_config.model) writeBack.model = gateway_config.model
        if (gateway_config.identity) writeBack.identity = gateway_config.identity
        if (gateway_config.sandbox) writeBack.sandbox = gateway_config.sandbox
        if (gateway_config.tools) writeBack.tools = gateway_config.tools
        if (gateway_config.subagents) writeBack.subagents = gateway_config.subagents
        if (gateway_config.memorySearch) writeBack.memorySearch = gateway_config.memorySearch

        await writeAgentToConfig(writeBack)

        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
        logAuditEvent({
          action: 'agent_config_writeback',
          actor: auth.user.username,
          actor_id: auth.user.id,
          target_type: 'agent',
          target_id: agent.id,
          detail: { agent_name: agent.name, openclaw_id: openclawId, fields: Object.keys(gateway_config) },
          ip_address: ipAddress,
        })
      } catch (err: any) {
        return NextResponse.json({
          warning: `Agent updated in MC but gateway write failed: ${err.message}`,
          agent: { ...agent, config: newConfig, role: role || agent.role, updated_at: now },
        })
      }
    }

    await db_helpers.logActivity(
      'agent_config_updated',
      'agent',
      agent.id,
      auth.user.username,
      `Config updated for agent ${agent.name}${write_to_gateway ? ' (+ gateway)' : ''}`,
      { fields: Object.keys(gateway_config || {}), write_to_gateway }
    )

    eventBus.broadcast('agent.updated', {
      id: agent.id,
      name: agent.name,
      config: newConfig,
      updated_at: now,
    })

    return NextResponse.json({
      success: true,
      agent: { ...agent, config: newConfig, role: role || agent.role, updated_at: now },
    })
  } catch (error: any) {
    console.error('PUT /api/agents/[id] error:', error)
    return NextResponse.json({ error: error.message || 'Failed to update agent' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/[id] - Delete an agent
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params

    let agentRows
    if (isNaN(Number(id))) {
      agentRows = await db.select().from(agents).where(eq(agents.name, id)).limit(1)
    } else {
      agentRows = await db.select().from(agents).where(eq(agents.id, Number(id))).limit(1)
    }
    const agent = agentRows[0]

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    await db.delete(agents).where(eq(agents.id, agent.id))

    await db_helpers.logActivity(
      'agent_deleted',
      'agent',
      agent.id,
      auth.user.username,
      `Deleted agent: ${agent.name}`,
      { name: agent.name, role: agent.role }
    )

    eventBus.broadcast('agent.deleted', { id: agent.id, name: agent.name })

    return NextResponse.json({ success: true, deleted: agent.name })
  } catch (error) {
    console.error('DELETE /api/agents/[id] error:', error)
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 })
  }
}
