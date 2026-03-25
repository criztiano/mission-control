import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getProject, updateProject, archiveProject, getProjectTaskCount, getProjectLastActivity } from '@/lib/cc-db';

/**
 * GET /api/projects/[id] - Get single project with task count and last activity
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  try {
    const project = await getProject(id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const taskCount = await getProjectTaskCount(id);
    const lastActivity = await getProjectLastActivity(id);

    return NextResponse.json({
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        emoji: project.emoji,
        repo_url: project.repo_url,
        local_path: project.local_path,
        taskCount,
        lastActivity,
      },
    });
  } catch (error) {
    logger.error({ err: error, projectId: id }, 'GET /api/projects/[id] error');
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 });
  }
}

/**
 * PUT /api/projects/[id] - Update project title, description, emoji
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  try {
    const body = await request.json();
    const { title, description, emoji, repo_url, local_path } = body;

    if (title === undefined && description === undefined && emoji === undefined && repo_url === undefined && local_path === undefined) {
      return NextResponse.json(
        { error: 'At least one field (title, description, emoji, repo_url, local_path) is required' },
        { status: 400 }
      );
    }

    const project = await getProject(id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const updates: any = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (emoji !== undefined) updates.emoji = emoji;
    if (repo_url !== undefined) updates.repo_url = repo_url;
    if (local_path !== undefined) updates.local_path = local_path;

    await updateProject(id, updates);

    return NextResponse.json({ success: true, project: { id, ...updates } });
  } catch (error) {
    logger.error({ err: error, projectId: id }, 'PUT /api/projects/[id] error');
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}

/**
 * DELETE /api/projects/[id] - Archive (soft delete) a project
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  try {
    const project = await getProject(id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    await archiveProject(id);

    return NextResponse.json({ success: true, message: 'Project archived' });
  } catch (error) {
    logger.error({ err: error, projectId: id }, 'DELETE /api/projects/[id] error');
    return NextResponse.json({ error: 'Failed to archive project' }, { status: 500 });
  }
}
