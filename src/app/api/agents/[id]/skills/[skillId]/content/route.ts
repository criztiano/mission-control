import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { agents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { saveSkillContent } from '@/lib/agent-skills'

/**
 * PUT /api/agents/[id]/skills/[skillId]/content - Save skill content
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
    const { content } = body

    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
    }

    const result = await saveSkillContent(agentId, skillId, content)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('PUT /api/agents/[id]/skills/[skillId]/content error:', error)
    return NextResponse.json({ error: 'Failed to save skill content' }, { status: 500 })
  }
}
