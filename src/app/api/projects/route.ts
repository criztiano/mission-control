import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getProjects, createProject } from '@/lib/cc-db';
import { db } from '@/db/client';
import { issues } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';

/**
 * GET /api/projects - List all projects from control-center.db with task counts and last activity
 *
 * Batch strategy: 2 queries total regardless of project count
 *   Q1 — COUNT(*) GROUP BY project_id (task counts)
 *   Q2 — MAX(updated_at) GROUP BY project_id (last activity)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const projectList = await getProjects();

    if (projectList.length === 0) {
      return NextResponse.json({ projects: [] });
    }

    // Batch Q1: task counts per project
    const taskCountRows = await db
      .select({
        project_id: issues.project_id,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(issues)
      .where(and(eq(issues.archived, false)))
      .groupBy(issues.project_id);

    const taskCountMap = new Map<string, number>(
      taskCountRows
        .filter(r => r.project_id != null)
        .map(r => [r.project_id as string, r.count])
    );

    // Batch Q2: last activity per project (MAX updated_at)
    const lastActivityRows = await db
      .select({
        project_id: issues.project_id,
        last_updated: sql<string>`MAX(${issues.updated_at})`,
      })
      .from(issues)
      .where(and(eq(issues.archived, false)))
      .groupBy(issues.project_id);

    const lastActivityMap = new Map<string, number>(
      lastActivityRows
        .filter(r => r.project_id != null && r.last_updated != null)
        .map(r => {
          const ts = r.last_updated ? Math.floor(new Date(r.last_updated).getTime() / 1000) : 0;
          return [r.project_id as string, isNaN(ts) ? 0 : ts];
        })
    );

    // Batch Q3: open task count for Cri's tasks only (for with_counts=true filter chip badges)
    const { searchParams } = new URL(request.url);
    const withCounts = searchParams.get('with_counts') === 'true';

    const criOpenCountMap = new Map<string, number>();
    if (withCounts) {
      const criOpenRows = await db
        .select({
          project_id: issues.project_id,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(issues)
        .where(and(
          eq(issues.archived, false),
          eq(issues.status, 'open'),
          sql`LOWER(${issues.assignee}) = 'cri'`,
        ))
        .groupBy(issues.project_id);

      for (const r of criOpenRows) {
        if (r.project_id != null) criOpenCountMap.set(r.project_id, r.count);
      }
    }

    const projectsWithStats = projectList.map(p => ({
      id: p.id,
      title: p.title,
      description: p.description,
      emoji: p.emoji,
      repo_url: p.repo_url,
      local_path: p.local_path,
      taskCount: taskCountMap.get(p.id) ?? 0,
      lastActivity: lastActivityMap.get(p.id) ?? 0,
      ...(withCounts ? { open_task_count: criOpenCountMap.get(p.id) ?? 0 } : {}),
    }));

    // Sort by last activity descending when with_counts requested (for filter chips)
    if (withCounts) {
      projectsWithStats.sort((a, b) => b.lastActivity - a.lastActivity);
    }

    return NextResponse.json({ projects: projectsWithStats });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/projects error');
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}

/**
 * POST /api/projects - Create a new project manually (without AI generation)
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const { title, description, emoji, repo_url, local_path } = body;

    // Validate required field
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json(
        { error: 'Title is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    const project = await createProject(
      title.trim(),
      description || '',
      emoji || '📁',
      repo_url || '',
      local_path || ''
    );

    return NextResponse.json({
      success: true,
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        emoji: project.emoji,
        repo_url: project.repo_url,
        local_path: project.local_path,
        taskCount: 0,
        lastActivity: 0,
      },
    }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/projects error');
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
