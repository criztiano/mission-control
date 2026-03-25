import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getIssue, getTurns, createTurn, getProject, type TurnType } from '@/lib/cc-db';
import { dispatchTaskNudge } from '@/lib/task-dispatch';
import { postTaskCard } from '@/lib/discord-cards';

const SPAWN_AGENTS = new Set(['dumbo', 'uze', 'ralph', 'piem', 'cody']);

/**
 * GET /api/tasks/[id]/turns — all turns for a task, ordered by round ASC, created_at ASC
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id: taskId } = await params;

    const issue = getIssue(taskId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const turns = getTurns(taskId);

    return NextResponse.json({ turns, total: turns.length });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id]/turns error');
    return NextResponse.json({ error: 'Failed to fetch turns' }, { status: 500 });
  }
}

/**
 * POST /api/tasks/[id]/turns — create a new turn
 * Body: { assigned_to, content, links? }
 * Legacy fields (type, author) are accepted but optional — inferred if missing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const { id: taskId } = await params;
    const body = await request.json();

    const { content, links, assigned_to, type, author } = body;

    // assigned_to is required
    if (!assigned_to) {
      return NextResponse.json(
        { error: 'assigned_to is required' },
        { status: 400 }
      );
    }

    const issue = getIssue(taskId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Infer author from current assignee if not provided
    const turnAuthor = author || issue.assignee || auth.user?.username || 'system';

    // Default type to 'result' if not provided
    const turnType: TurnType = type || 'result';

    const turn = createTurn(taskId, {
      assigned_to,
      content: content || '',
      links: links || [],
      type: turnType,
      author: turnAuthor,
    });

    // Fire-and-forget Discord notification when turn is assigned to a human
    if (assigned_to && !SPAWN_AGENTS.has(assigned_to.toLowerCase())) {
      void (async () => {
        try {
          let projectName: string | undefined;
          if (issue.project_id) {
            const project = getProject(issue.project_id);
            projectName = project?.title;
          }
          await postTaskCard({
            taskId,
            title: issue.title,
            description: issue.description,
            project: projectName,
            planId: issue.plan_id,
            turn: {
              author: turnAuthor,
              content: content || '',
              links: links || [],
            },
          });
        } catch (e) {
          logger.warn({ err: e, taskId }, 'Discord task card notification failed');
        }
      })();
    }

    // Dispatch on every turn (not just instruction/result)
    const updatedIssue = getIssue(taskId);
    const newAssignee = updatedIssue?.assignee || '';

    if (newAssignee && newAssignee !== turnAuthor) {
      try {
        await dispatchTaskNudge({
          taskId,
          title: issue.title,
          assignee: newAssignee,
          reason: 'reassign',
          content: content || '',
        });
      } catch (e) {
        logger.warn({ err: e, taskId }, 'task dispatch nudge failed on turn');
      }
    }

    // Queue drain: if the author is a known spawn agent, check for their next open task
    if (SPAWN_AGENTS.has(turnAuthor.toLowerCase())) {
      try {
        const { getCCDatabase } = await import('@/lib/cc-db');
        const db = getCCDatabase();
        const nextTask = db.prepare(`
          SELECT id, title FROM issues
          WHERE LOWER(assignee) = LOWER(?) AND status = 'open' AND (picked = 0 OR picked IS NULL) AND id != ?
          ORDER BY
            CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
            created_at ASC
          LIMIT 1
        `).get(turnAuthor, taskId) as { id: string; title: string } | undefined;

        if (nextTask) {
          logger.info({ agent: turnAuthor, nextTaskId: nextTask.id, nextTitle: nextTask.title }, 'Queue drain: dispatching next task');
          await dispatchTaskNudge({
            taskId: nextTask.id,
            title: nextTask.title,
            assignee: turnAuthor,
            reason: 'reassign',
          });
        }
      } catch (e) {
        logger.warn({ err: e, agent: turnAuthor }, 'Queue drain failed');
      }
    }

    return NextResponse.json({ turn }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/turns error');
    return NextResponse.json({ error: 'Failed to create turn' }, { status: 500 });
  }
}
