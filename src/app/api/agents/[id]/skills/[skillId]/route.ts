import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { toggleSkill, getSkillContent, saveSkillContent } from '@/lib/agent-skills'

/**
 * PUT /api/agents/[id]/skills/[skillId] - Toggle skill on/off for agent
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; skillId: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const skillId = resolvedParams.skillId

    // Get agent by ID or name
    let agent: any
    if (isNaN(Number(agentId))) {
      agent = db.prepare('SELECT id, name FROM agents WHERE name = ?').get(agentId)
    } else {
      agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(Number(agentId))
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const body = await request.json()
    const { enabled } = body

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }

    const result = toggleSkill(agentId, skillId, enabled)

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
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const skillId = resolvedParams.skillId

    // Get agent by ID or name
    let agent: any
    if (isNaN(Number(agentId))) {
      agent = db.prepare('SELECT id, name FROM agents WHERE name = ?').get(agentId)
    } else {
      agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(Number(agentId))
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const result = getSkillContent(agentId, skillId)

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('GET /api/agents/[id]/skills/[skillId] error:', error)
    return NextResponse.json({ error: 'Failed to get skill content' }, { status: 500 })
  }
}
