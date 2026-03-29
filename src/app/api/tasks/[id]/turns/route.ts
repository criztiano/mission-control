import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getIssue, getTurns, createTurn, getProject, type TurnType } from '@/lib/cc-db';
import { dispatchTaskNudge, markDispatchCompleted, cascadeDispatchOnClose } from '@/lib/task-dispatch';
import { postTaskCard } from '@/lib/discord-cards';
import { db } from '@/db/client';
import { issues } from '@/db/schema';
import { eq, and, ne, isNull, or } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

const SPAWN_AGENTS = new Set(['dumbo', 'uze', 'ralph', 'piem', 'cody']);

/**
 * GET /api/tasks/[id]/turns — all turns for a task
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id: taskId } = await params;

    const [issue, turns] = await Promise.all([getIssue(taskId), getTurns(taskId)]);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({ turns, total: turns.length });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id]/turns error');
    return NextResponse.json({ error: 'Failed to fetch turns' }, { status: 500 });
  }
}

/**
 * POST /api/tasks/[id]/turns — create a new turn
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const { id: taskId } = await params;
    const body = await request.json();

    const { content, links, assigned_to, type, author } = body;

    if (!assigned_to) {
      return NextResponse.json({ error: 'assigned_to is required' }, { status: 400 });
    }

    const issue = await getIssue(taskId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const turnAuthor = author || issue.assignee || auth.user?.username || 'system';
    const turnType: TurnType = type || 'result';

    // Mark dispatch as completed when an agent posts a turn
    if (SPAWN_AGENTS.has(turnAuthor.toLowerCase())) {
      void markDispatchCompleted(taskId, turnAuthor.toLowerCase()).catch(() => {})
    }

    const turn = await createTurn(taskId, {
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
            const project = await getProject(issue.project_id);
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

    // Auto-close: when a PM posts a "Done" review turn on a sub-task, close it and cascade
    const PM_AGENTS = new Set(['piem', 'ralph']);
    const isDoneTurn = (content || '').includes('✅ Done') || (content || '').toLowerCase().startsWith('## done');
    const isPMAuthor = PM_AGENTS.has(turnAuthor.toLowerCase());
    const isSubTask = !!issue.parent_id;

    if (isPMAuthor && isDoneTurn && isSubTask && issue.status === 'open') {
      await db.update(issues).set({ status: 'closed', updated_at: new Date().toISOString() }).where(eq(issues.id, taskId));
      logger.info({ taskId, pm: turnAuthor, parentId: issue.parent_id }, 'Auto-closed sub-task after PM review');

      void cascadeDispatchOnClose(taskId).catch((e: Error) => {
        logger.warn({ err: e, taskId }, 'cascade dispatch after auto-close failed');
      });
    }

    // Dispatch on every turn
    // assigned_to is authoritative — createTurn just set issue.assignee = assigned_to
    const newAssignee = assigned_to;

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
        const nextTaskRows = await db.execute(sql`
          SELECT id, title FROM issues
          WHERE LOWER(assignee) = LOWER(${turnAuthor})
            AND status = 'open'
            AND (picked = false OR picked IS NULL)
            AND id != ${taskId}
          ORDER BY
            CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
            created_at ASC
          LIMIT 1
        `);

        const nextTask = nextTaskRows.rows[0] as { id: string; title: string } | undefined;

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
