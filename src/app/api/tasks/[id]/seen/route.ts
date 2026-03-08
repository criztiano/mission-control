import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getIssue, setTaskSeen } from '@/lib/cc-db';

/**
 * PUT /api/tasks/[id]/seen — set seen_at=now
 * Called when user opens the task detail modal.
 */
export async function PUT(
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

    setTaskSeen(taskId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/tasks/[id]/seen error');
    return NextResponse.json({ error: 'Failed to mark task as seen' }, { status: 500 });
  }
}
