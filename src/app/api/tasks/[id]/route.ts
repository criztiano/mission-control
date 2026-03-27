import { NextRequest, NextResponse } from 'next/server';
import { db_helpers } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';
import { getUserFromRequest, requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  getIssue,
  getProject,
  mapIssueToTask,
  PRIORITY_FROM_MC,
  getBlockerInfo,
  type IssueStatus,
} from '@/lib/cc-db';
import { db } from '@/db/client';
import { issues } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { dispatchTaskNudge } from '@/lib/task-dispatch';

const VALID_STATUSES: Set<string> = new Set(['draft', 'open', 'closed']);

/**
 * GET /api/tasks/[id] - Get a specific issue from control-center.db
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id: issueId } = await params;

    const issue = await getIssue(issueId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const [projectRow, blockerInfoResult] = await Promise.all([
      issue.project_id ? getProject(issue.project_id) : Promise.resolve(undefined),
      // blockerIds must come from the mapped task — compute them after mapIssueToTask
      // We parse blocked_by early so both queries can fire in parallel
      (() => {
        let ids: string[] = [];
        try { ids = JSON.parse(issue.blocked_by || '[]'); } catch { /* ignore */ }
        return ids.length > 0 ? getBlockerInfo(ids) : Promise.resolve({ details: [], openIds: new Set<string>() });
      })(),
    ]);
    const task = mapIssueToTask(issue, projectRow?.title);
    (task as any).is_blocked = (task.blocked_by || []).some((id: string) => blockerInfoResult.openIds.has(id));
    (task as any).blocker_details = blockerInfoResult.details;

    return NextResponse.json({ task });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id] error');
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}

/**
 * PUT /api/tasks/[id] - Update an issue in control-center.db
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const { id: issueId } = await params;
    const body = await request.json();

    const currentIssue = await getIssue(issueId);
    if (!currentIssue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const {
      title,
      description,
      status,
      priority,
      assigned_to,
      creator,
      project_id,
      plan_path,
      blocked_by,
    } = body;

    if (status && !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }

    if (status !== undefined && auth.user.username === 'api') {
      return NextResponse.json(
        { error: 'Agents cannot change task status. Use /api/tasks/{id}/turns to report work.' },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();

    // Build update object
    const updateFields: Record<string, any> = { updated_at: now };

    if (title !== undefined) updateFields.title = title;
    if (description !== undefined) updateFields.description = description;
    if (status !== undefined) updateFields.status = status;
    if (priority !== undefined) updateFields.priority = PRIORITY_FROM_MC[priority] || priority;
    if (assigned_to !== undefined) updateFields.assignee = assigned_to;
    if (creator !== undefined) updateFields.creator = creator;
    if (project_id !== undefined) updateFields.project_id = project_id || null;
    if (plan_path !== undefined) updateFields.plan_path = plan_path || null;
    if (blocked_by !== undefined) {
      if (!Array.isArray(blocked_by)) {
        return NextResponse.json({ error: 'blocked_by must be an array of task IDs' }, { status: 400 });
      }
      updateFields.blocked_by = JSON.stringify(blocked_by);
    }

    if (Object.keys(updateFields).length <= 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    await db.update(issues).set(updateFields).where(eq(issues.id, issueId));

    // Track changes for activity log
    const changes: string[] = [];
    if (status && status !== currentIssue.status) changes.push(`status: ${currentIssue.status} -> ${status}`);
    if (assigned_to !== undefined && assigned_to !== currentIssue.assignee) changes.push(`assigned: ${currentIssue.assignee || 'unassigned'} -> ${assigned_to || 'unassigned'}`);
    if (title && title !== currentIssue.title) changes.push('title updated');
    if (priority) {
      const ccOldPriority = currentIssue.priority;
      const ccNewPriority = PRIORITY_FROM_MC[priority] || priority;
      if (ccNewPriority !== ccOldPriority) changes.push(`priority: ${ccOldPriority} -> ${ccNewPriority}`);
    }

    if (changes.length > 0) {
      await db_helpers.logActivity(
        'task_updated',
        'task',
        0,
        getUserFromRequest(request)?.username || 'system',
        `Task updated: ${changes.join(', ')}`,
        { changes }
      );
    }

    const updatedIssue = await getIssue(issueId);
    if (!updatedIssue) {
      return NextResponse.json({ error: 'Task not found after update' }, { status: 500 });
    }

    const projectRow = updatedIssue.project_id ? await getProject(updatedIssue.project_id) : undefined;
    const task = mapIssueToTask(updatedIssue, projectRow?.title);

    eventBus.broadcast('task.updated', task);

    const assigneeChanged = assigned_to !== undefined && assigned_to !== currentIssue.assignee;
    const becameOpen = status === 'open' && currentIssue.status !== 'open';
    const effectiveAssignee = assigned_to !== undefined ? assigned_to : currentIssue.assignee;

    if (effectiveAssignee && (assigneeChanged || becameOpen)) {
      void dispatchTaskNudge({
        taskId: issueId,
        title: updatedIssue.title,
        assignee: effectiveAssignee,
        reason: assigneeChanged ? 'reassign' : 'create',
        content: typeof description === 'string' ? description : (currentIssue.description || undefined),
      }).catch((e) => {
        logger.warn({ err: e, taskId: issueId }, 'task dispatch nudge failed on update');
      });
    }

    return NextResponse.json({ task });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/tasks/[id] error');
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks/[id] - Archive an issue in control-center.db (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const { id: issueId } = await params;

    const issue = await getIssue(issueId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    await db.update(issues).set({ archived: true, updated_at: new Date().toISOString() }).where(eq(issues.id, issueId));

    await db_helpers.logActivity(
      'task_deleted',
      'task',
      0,
      getUserFromRequest(request)?.username || 'system',
      `Archived task: ${issue.title}`,
      { title: issue.title, status: issue.status, assignee: issue.assignee }
    );

    eventBus.broadcast('task.deleted', { id: issueId, title: issue.title });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/tasks/[id] error');
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
