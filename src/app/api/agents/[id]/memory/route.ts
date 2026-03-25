import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { db_helpers } from '@/lib/db';
import { agents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { getAgentWorkspace, readWorkspaceFile, writeWorkspaceFile, listMemoryFiles } from '@/lib/agent-workspace';

/**
 * GET /api/agents/[id]/memory - Get agent's working memory
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const resolvedParams = await params;
    const agentId = resolvedParams.id;

    let agentRows;
    if (isNaN(Number(agentId))) {
      agentRows = await db.select().from(agents).where(eq(agents.name, agentId)).limit(1);
    } else {
      agentRows = await db.select().from(agents).where(eq(agents.id, Number(agentId))).limit(1);
    }
    const agent = agentRows[0];

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Try disk first
    let workingMemory: string | null = null;
    let source: 'disk' | 'db' = 'db';
    let dailyFiles: ReturnType<typeof listMemoryFiles> = [];
    const workspace = await getAgentWorkspace(agentId);

    if (workspace) {
      const diskContent = readWorkspaceFile(workspace, 'MEMORY.md');
      if (diskContent !== null) {
        workingMemory = diskContent;
        source = 'disk';
      }
      dailyFiles = listMemoryFiles(workspace);
    }

    // Fall back to empty string (working_memory column doesn't exist in Drizzle schema)
    if (workingMemory === null) {
      workingMemory = '';
    }

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role
      },
      working_memory: workingMemory,
      source,
      workspace: workspace || null,
      daily_files: dailyFiles,
      updated_at: agent.updated_at,
      size: (workingMemory || '').length
    });
  } catch (error) {
    console.error('GET /api/agents/[id]/memory error:', error);
    return NextResponse.json({ error: 'Failed to fetch working memory' }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[id]/memory - Update agent's working memory
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const resolvedParams = await params;
    const agentId = resolvedParams.id;
    const body = await request.json();
    const { working_memory, append } = body;

    let agentRows;
    if (isNaN(Number(agentId))) {
      agentRows = await db.select().from(agents).where(eq(agents.name, agentId)).limit(1);
    } else {
      agentRows = await db.select().from(agents).where(eq(agents.id, Number(agentId))).limit(1);
    }
    const agent = agentRows[0];

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    let newContent = working_memory || '';

    // Handle append mode
    if (append) {
      let currentContent = '';
      const workspace = await getAgentWorkspace(agentId);
      if (workspace) {
        currentContent = readWorkspaceFile(workspace, 'MEMORY.md') || '';
      }

      const timestamp = new Date().toISOString();
      newContent = currentContent + (currentContent ? '\n\n' : '') +
                   `## ${timestamp}\n${working_memory}`;
    }

    // Write to disk first
    let wroteToFile = false;
    const workspace = await getAgentWorkspace(agentId);
    if (workspace) {
      try {
        writeWorkspaceFile(workspace, 'MEMORY.md', newContent);
        wroteToFile = true;
      } catch (err) {
        console.error('Failed to write MEMORY.md to disk:', err);
      }
    }

    const now = Math.floor(Date.now() / 1000);

    // Update agent updated_at in DB
    await db.update(agents).set({ updated_at: now }).where(eq(agents.id, agent.id));

    await db_helpers.logActivity(
      'agent_memory_updated',
      'agent',
      agent.id,
      agent.name,
      `Working memory ${append ? 'appended' : 'updated'} for agent ${agent.name}`,
      {
        content_length: newContent.length,
        append_mode: append || false,
        wrote_to_disk: wroteToFile,
        timestamp: now
      }
    );

    return NextResponse.json({
      success: true,
      message: `Working memory ${append ? 'appended' : 'updated'} for ${agent.name}`,
      working_memory: newContent,
      source: wroteToFile ? 'disk' : 'db',
      updated_at: now,
      size: newContent.length
    });
  } catch (error) {
    console.error('PUT /api/agents/[id]/memory error:', error);
    return NextResponse.json({ error: 'Failed to update working memory' }, { status: 500 });
  }
}

/**
 * DELETE /api/agents/[id]/memory - Clear agent's working memory
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const resolvedParams = await params;
    const agentId = resolvedParams.id;

    let agentRows;
    if (isNaN(Number(agentId))) {
      agentRows = await db.select().from(agents).where(eq(agents.name, agentId)).limit(1);
    } else {
      agentRows = await db.select().from(agents).where(eq(agents.id, Number(agentId))).limit(1);
    }
    const agent = agentRows[0];

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const workspace = await getAgentWorkspace(agentId);
    if (workspace) {
      try {
        writeWorkspaceFile(workspace, 'MEMORY.md', '');
      } catch (err) {
        console.error('Failed to clear MEMORY.md on disk:', err);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    await db.update(agents).set({ updated_at: now }).where(eq(agents.id, agent.id));

    await db_helpers.logActivity(
      'agent_memory_cleared',
      'agent',
      agent.id,
      agent.name,
      `Working memory cleared for agent ${agent.name}`,
      { timestamp: now }
    );

    return NextResponse.json({
      success: true,
      message: `Working memory cleared for ${agent.name}`,
      working_memory: '',
      updated_at: now
    });
  } catch (error) {
    console.error('DELETE /api/agents/[id]/memory error:', error);
    return NextResponse.json({ error: 'Failed to clear working memory' }, { status: 500 });
  }
}
