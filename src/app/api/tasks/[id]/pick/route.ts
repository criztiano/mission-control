import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getIssue, setTaskPicked } from '@/lib/cc-db';

/**
 * PUT /api/tasks/[id]/pick — set picked=1, picked_at=now
 * Called by agent when starting work on a task.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id: taskId } = await params;

    const issue = getIssue(taskId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    setTaskPicked(taskId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/tasks/[id]/pick error');
    return NextResponse.json({ error: 'Failed to pick task' }, { status: 500 });
  }
}
