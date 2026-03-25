import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { db_helpers } from '@/lib/db'
import { agents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFromRequest, requireRole } from '@/lib/auth'
import {
  getAgentWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile,
  isAllowedFile,
} from '@/lib/agent-workspace'

/**
 * GET /api/agents/[id]/files/[filename] - Read a specific workspace file
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const filename = decodeURIComponent(resolvedParams.filename)

    if (!isAllowedFile(filename)) {
      return NextResponse.json({ error: 'File not in whitelist' }, { status: 403 })
    }

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

    const workspace = await getAgentWorkspace(agentId)
    if (!workspace) {
      return NextResponse.json({ error: 'No workspace configured' }, { status: 404 })
    }

    const content = readWorkspaceFile(workspace, filename)
    if (content === null) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name },
      filename,
      content,
      size: content.length,
      readonly: filename === 'USER.md',
    })
  } catch (error: any) {
    if (error.message === 'Path escapes workspace directory') {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
    }
    console.error('GET /api/agents/[id]/files/[filename] error:', error)
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
  }
}

/**
 * PUT /api/agents/[id]/files/[filename] - Write a specific workspace file
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const filename = decodeURIComponent(resolvedParams.filename)

    if (!isAllowedFile(filename)) {
      return NextResponse.json({ error: 'File not in whitelist' }, { status: 403 })
    }

    if (filename === 'USER.md') {
      return NextResponse.json({ error: 'USER.md is read-only' }, { status: 403 })
    }

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

    const workspace = await getAgentWorkspace(agentId)
    if (!workspace) {
      return NextResponse.json({ error: 'No workspace configured' }, { status: 404 })
    }

    const body = await request.json()
    const { content } = body
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
    }

    writeWorkspaceFile(workspace, filename, content)

    await db_helpers.logActivity(
      'agent_file_updated',
      'agent',
      agent.id,
      getUserFromRequest(request)?.username || 'system',
      `${filename} updated for agent ${agent.name}`,
      { filename, content_length: content.length }
    )

    return NextResponse.json({
      success: true,
      message: `${filename} updated for ${agent.name}`,
      filename,
      size: content.length,
    })
  } catch (error: any) {
    if (error.message === 'Path escapes workspace directory') {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
    }
    console.error('PUT /api/agents/[id]/files/[filename] error:', error)
    return NextResponse.json({ error: 'Failed to write file' }, { status: 500 })
  }
}
