import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getCCDatabase } from '@/lib/cc-db';
import { dispatchTaskNudge, isAgentAssignee } from '@/lib/task-dispatch';
import { logger } from '@/lib/logger';

/**
 * POST /api/tasks/[id]/poke — resend nudge to assigned agent
 *
 * Used when a task is assigned but the agent hasn't picked it up.
 * Re-triggers the dispatch nudge. Only works for agent assignees.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id } = await params;
    const db = getCCDatabase();
    
    const task = db.prepare('SELECT * FROM issues WHERE id = ? AND archived = 0').get(id) as any;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!task.assignee) {
      return NextResponse.json({ error: 'Task has no assignee' }, { status: 400 });
    }

    if (!isAgentAssignee(task.assignee)) {
      return NextResponse.json({ error: `${task.assignee} is not an agent — can only poke agents` }, { status: 400 });
    }

    // Re-dispatch the nudge
    const result = await dispatchTaskNudge({
      taskId: id,
      title: task.title,
      assignee: task.assignee,
      reason: 'create',
      content: task.description || undefined,
    });

    logger.info({ taskId: id, assignee: task.assignee, result }, 'Task poked');

    return NextResponse.json({ 
      ok: true, 
      assignee: task.assignee,
      dispatch: result 
    });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/poke error');
    return NextResponse.json({ error: 'Poke failed' }, { status: 500 });
  }
}
