import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { agents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { getAgentSkills } from '@/lib/agent-skills'

/**
 * GET /api/agents/[id]/skills - List all skills with enabled state for this agent
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params
    const agentId = resolvedParams.id

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

    const skills = await getAgentSkills(agentId)

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name },
      skills
    })
  } catch (error) {
    console.error('GET /api/agents/[id]/skills error:', error)
    return NextResponse.json({ error: 'Failed to list skills' }, { status: 500 })
  }
}
