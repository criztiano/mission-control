import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { getAgentSkills } from '@/lib/agent-skills'

/**
 * GET /api/agents/[id]/skills - List all skills with enabled state for this agent
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const agentId = resolvedParams.id

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

    const skills = getAgentSkills(agentId)

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name },
      skills
    })
  } catch (error) {
    console.error('GET /api/agents/[id]/skills error:', error)
    return NextResponse.json({ error: 'Failed to list skills' }, { status: 500 })
  }
}
