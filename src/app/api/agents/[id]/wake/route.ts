import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { db_helpers } from '@/lib/db'
import { agents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { runOpenClaw } from '@/lib/command'
import { requireRole } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const body = await request.json().catch(() => ({}))
    const customMessage =
      typeof body?.message === 'string' ? body.message.trim() : ''

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

    if (!agent.session_key) {
      return NextResponse.json(
        { error: 'Agent has no session key configured' },
        { status: 400 }
      )
    }

    const message =
      customMessage ||
      `Wake up check-in for ${agent.name}. Please review assigned tasks and notifications.`

    const { stdout, stderr } = await runOpenClaw(
      ['gateway', 'sessions_send', '--session', agent.session_key, '--message', message],
      { timeoutMs: 10000 }
    )

    if (stderr && stderr.includes('error')) {
      return NextResponse.json(
        { error: stderr.trim() || 'Failed to wake agent' },
        { status: 500 }
      )
    }

    await db_helpers.updateAgentStatus(agent.name, 'idle', 'Manual wake')

    return NextResponse.json({
      success: true,
      session_key: agent.session_key,
      stdout: stdout.trim()
    })
  } catch (error) {
    console.error('POST /api/agents/[id]/wake error:', error)
    return NextResponse.json({ error: 'Failed to wake agent' }, { status: 500 })
  }
}
