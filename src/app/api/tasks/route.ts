import { NextRequest, NextResponse } from 'next/server';
import { db_helpers } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  getIssues,
  getProject,
  getProjectsByIds,
  mapIssueToTask,
  PRIORITY_FROM_MC,
  parseBlockedBy,
  getOpenBlockerIds,
  type IssueStatus,
  type KanbanColumn,
} from '@/lib/cc-db';
import { db } from '@/db/client';
import { issues } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { dispatchTaskNudge } from '@/lib/task-dispatch';

const VALID_STATUSES: Set<string> = new Set(['draft', 'open', 'closed']);

/**
 * GET /api/tasks - List all tasks from control-center.db issues table
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') || undefined;
    const assigned_to_raw = searchParams.get('assigned_to') || undefined;
    const priority = searchParams.get('priority') || undefined;
    const column = (searchParams.get('column') || undefined) as KanbanColumn | undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');

    // Support negation: assigned_to=!cri means "NOT assigned to cri"
    const isNegation = assigned_to_raw?.startsWith('!') ?? false
    const assigned_to = isNegation ? undefined : assigned_to_raw
    const assigned_to_not = isNegation && assigned_to_raw ? assigned_to_raw.slice(1) : undefined

    const { issues: issueList, total } = await getIssues({ status, assigned_to, assigned_to_not, priority, column, limit, offset });

    const projectIds = [...new Set(issueList.map(i => i.project_id).filter(Boolean))] as string[];
    const projectRows = await getProjectsByIds(projectIds);
    const projectMap = new Map<string, string>();
    for (const [id, p] of projectRows) {
      projectMap.set(id, p.title);
    }

    const tasks = issueList.map(issue =>
      mapIssueToTask(issue, issue.project_id ? projectMap.get(issue.project_id) : undefined)
    );

    // Truncate description in list view — full text is available via GET /api/tasks/[id]
    for (const task of tasks) {
      if (task.description && task.description.length > 200) {
        task.description = task.description.slice(0, 200) + '…';
      }
    }

    const allBlockerIds = [...new Set(tasks.flatMap(t => t.blocked_by || []))];
    const openBlockers = await getOpenBlockerIds(allBlockerIds);

    // Strip redundant fields from list view — metadata duplicates top-level fields already present
    // (project_id, project_title, parent_id), plan_path is deprecated. Both save ~20KB per response.
    const listTasks = tasks.map((task) => {
      const { metadata: _metadata, plan_path: _planPath, ...rest } = task as any;
      rest.is_blocked = (task.blocked_by || []).some((id: string) => openBlockers.has(id));
      return rest;
    });

    return NextResponse.json({ tasks: listTasks, total, page: Math.floor(offset / limit) + 1, limit });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks error');
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

/**
 * POST /api/tasks - Create a new issue in control-center.db
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const body = await request.json();
    const user = auth.user;

    let {
      title,
      description = '',
      status = 'open',
      priority = 'medium',
      assigned_to = '',
      creator = user?.username || 'system',
      metadata = {},
    } = body;

    if ((!title || typeof title !== 'string' || title.trim().length === 0) && description.trim().length > 0) {
      const { generateTaskLabel } = await import('@/lib/ai-label');
      const label = await generateTaskLabel(description);
      title = label.title;
      description = label.description;
    }

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Title or description is required' }, { status: 400 });
    }

    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}. Valid: ${[...VALID_STATUSES].join(', ')}` }, { status: 400 });
    }

    const ccPriority = PRIORITY_FROM_MC[priority] || 'normal';
    const now = new Date().toISOString();
    const id = randomUUID();
    const projectId = metadata?.project_id || '';

    const blockedBy = Array.isArray(body.blocked_by) ? JSON.stringify(body.blocked_by) : '[]';

    await db.insert(issues).values({
      id,
      project_id: projectId || null,
      title,
      description,
      status: status as IssueStatus,
      assignee: assigned_to,
      creator,
      priority: ccPriority,
      created_at: now,
      updated_at: now,
      archived: false,
      blocked_by: blockedBy,
    });

    const projectTitle = projectId ? (await getProject(projectId))?.title : undefined;
    const task = mapIssueToTask(
      {
        id,
        project_id: projectId || null,
        title,
        description,
        status: status as IssueStatus,
        assignee: assigned_to,
        creator,
        priority: ccPriority as 'low' | 'normal' | 'high',
        created_at: now,
        updated_at: now,
        archived: false,
        schedule: '',
        parent_id: null,
        notion_id: '',
        plan_path: null,
        plan_id: null,
        last_turn_at: null,
        seen_at: null,
        picked: false,
        picked_at: null,
        picked_by: '',
        blocked_by: '[]',
      },
      projectTitle,
    );

    await db_helpers.logActivity('task_created', 'task', 0, creator, `Created task: ${title}`, {
      title, status, priority, assigned_to,
    });

    eventBus.broadcast('task.created', task);

    void dispatchTaskNudge({
      taskId: id,
      title,
      assignee: assigned_to,
      reason: 'create',
      content: description,
    }).catch((e) => {
      logger.warn({ err: e, taskId: id }, 'task dispatch nudge failed on create');
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks error');
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}

/**
 * PUT /api/tasks - Bulk update issues in control-center.db (drag-and-drop)
 */
export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const { tasks } = await request.json();

    if (!Array.isArray(tasks)) {
      return NextResponse.json({ error: 'Tasks must be an array' }, { status: 400 });
    }

    for (const item of tasks) {
      if (item.status && !VALID_STATUSES.has(item.status)) {
        return NextResponse.json({ error: `Invalid status: ${item.status}` }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const actor = auth.user.username;

    // Update each task individually (Neon doesn't support SQLite transactions the same way)
    for (const item of tasks) {
      const updateFields: Record<string, any> = { updated_at: now };
      if (item.status !== undefined) updateFields.status = item.status;
      if (item.assigned_to !== undefined) updateFields.assignee = item.assigned_to;

      if (Object.keys(updateFields).length > 1) {
        await db.update(issues).set(updateFields).where(eq(issues.id, item.id));
      }
    }

    for (const task of tasks) {
      const changes: string[] = [];
      if (task.status) changes.push(`status → ${task.status}`);
      if (task.assigned_to !== undefined) changes.push(`assignee → ${task.assigned_to || 'unassigned'}`);

      eventBus.broadcast('task.updated', {
        id: task.id,
        status: task.status,
        assigned_to: task.assigned_to,
        updated_at: Math.floor(Date.now() / 1000),
      });
      await db_helpers.logActivity('task_updated', 'task', 0, actor, `Task updated: ${changes.join(', ')}`, { changes });
    }

    return NextResponse.json({ success: true, updated: tasks.length });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/tasks error');
    return NextResponse.json({ error: 'Failed to update tasks' }, { status: 500 });
  }
}
