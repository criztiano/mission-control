import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { saveSkillContent } from '@/lib/agent-skills'

/**
 * PUT /api/agents/[id]/skills/[skillId]/content - Save skill content
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
    const { content } = body

    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
    }

    const result = saveSkillContent(agentId, skillId, content)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('PUT /api/agents/[id]/skills/[skillId]/content error:', error)
    return NextResponse.json({ error: 'Failed to save skill content' }, { status: 500 })
  }
}
