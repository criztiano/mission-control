import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { agents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { toggleSkill, getSkillContent } from '@/lib/agent-skills'

/**
 * PUT /api/agents/[id]/skills/[skillId] - Toggle skill on/off for agent
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; skillId: string }> }
) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const skillId = resolvedParams.skillId

    let agentRows
    if (isNaN(Number(agentId))) {
      agentRows = await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.name, agentId)).limit(1)
    } else {
      agentRows = await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.id, Number(agentId))).limit(1)
    }
    const agent = agentRows[0]

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const body = await request.json()
    const { enabled } = body

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }

    const result = await toggleSkill(agentId, skillId, enabled)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true, enabled })
  } catch (error) {
    console.error('PUT /api/agents/[id]/skills/[skillId] error:', error)
    return NextResponse.json({ error: 'Failed to toggle skill' }, { status: 500 })
  }
}

/**
 * GET /api/agents/[id]/skills/[skillId] - Get skill content for viewing/editing
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; skillId: string }> }
) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const skillId = resolvedParams.skillId

    let agentRows
    if (isNaN(Number(agentId))) {
      agentRows = await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.name, agentId)).limit(1)
    } else {
      agentRows = await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.id, Number(agentId))).limit(1)
    }
    const agent = agentRows[0]

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const result = await getSkillContent(agentId, skillId)

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('GET /api/agents/[id]/skills/[skillId] error:', error)
    return NextResponse.json({ error: 'Failed to get skill content' }, { status: 500 })
  }
}
