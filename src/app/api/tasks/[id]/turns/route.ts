import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getIssue, getTurns, createTurn, type TurnType } from '@/lib/cc-db';
import { dispatchTaskNudge } from '@/lib/task-dispatch';

const VALID_TURN_TYPES = new Set<string>(['instruction', 'result', 'note']);

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
 * Body: { type, content, links?, assigned_to?, author? }
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

    const { type, content, links, assigned_to, author } = body;

    if (!type || !VALID_TURN_TYPES.has(type)) {
      return NextResponse.json(
        { error: `Invalid turn type. Valid: ${[...VALID_TURN_TYPES].join(', ')}` },
        { status: 400 }
      );
    }

    if (type === 'instruction' && !assigned_to) {
      return NextResponse.json(
        { error: 'assigned_to is required for instruction turns' },
        { status: 400 }
      );
    }

    const issue = getIssue(taskId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const turnAuthor = author || auth.user?.username || 'system';

    const turn = createTurn(taskId, {
      type: type as TurnType,
      author: turnAuthor,
      content: content || '',
      links: links || [],
      assigned_to,
    });

    // Dispatch to next agent:
    // - instruction turns: always dispatch to assigned_to
    // - result turns: dispatch only when explicitly routed to another agent (agent-to-agent pipeline)
    const shouldDispatch =
      (type === 'instruction' && assigned_to) ||
      (type === 'result' && assigned_to);

    if (shouldDispatch) {
      try {
        await dispatchTaskNudge({
          taskId,
          title: issue.title,
          assignee: assigned_to,
          reason: 'reassign',
          content: content || '',
        });
      } catch (e) {
        logger.warn({ err: e, taskId }, 'task dispatch nudge failed on turn');
      }
    }

    return NextResponse.json({ turn }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/turns error');
    return NextResponse.json({ error: 'Failed to create turn' }, { status: 500 });
  }
}
