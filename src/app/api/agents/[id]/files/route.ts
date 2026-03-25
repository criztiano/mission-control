import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { agents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { getAgentWorkspace, listWorkspaceFiles } from '@/lib/agent-workspace'

/**
 * GET /api/agents/[id]/files - List all .md files in the agent's workspace root
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

    // Get agent by ID or name
    let agentRows
    if (isNaN(Number(agentId))) {
      agentRows = await db.select().from(agents).where(eq(agents.name, agentId)).limit(1)
    } else {
      agentRows = await db.select().from(agents).where(eq(agents.id, Number(agentId))).limit(1)
    }
    const agent = agentRows[0]

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const workspace = await getAgentWorkspace(agentId)
    if (!workspace) {
      return NextResponse.json({
        agent: { id: agent.id, name: agent.name },
        workspace: null,
        files: [],
        message: 'No workspace configured for this agent'
      })
    }

    const files = listWorkspaceFiles(workspace)

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name },
      workspace,
      files
    })
  } catch (error) {
    console.error('GET /api/agents/[id]/files error:', error)
    return NextResponse.json({ error: 'Failed to list workspace files' }, { status: 500 })
  }
}
