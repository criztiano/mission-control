import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getIssue, getTurns, createTurn } from '@/lib/cc-db';
import { db } from '@/db/client';
import { issues } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/tasks/[id]/update — agent delivers work on a task
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

    const { agent, report, links, title, description } = body;

    if (!agent || typeof agent !== 'string') {
      return NextResponse.json({ error: 'agent is required — identify yourself' }, { status: 400 });
    }

    if (!report || typeof report !== 'string' || report.trim().length === 0) {
      return NextResponse.json({ error: 'report is required — describe what you did' }, { status: 400 });
    }

    const [issue, existingTurns] = await Promise.all([getIssue(taskId), getTurns(taskId)]);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    const hasDescription = issue.description && issue.description.trim().length > 0;

    if (existingTurns.length === 0 && !hasDescription) {
      if (!title || !description) {
        return NextResponse.json(
          { error: 'First update on a task without description requires title and description (refinement)' },
          { status: 400 }
        );
      }
    }

    // Single update: always reset picked state; conditionally include title/description.
    // Merges two sequential db.update(issues) calls into one round-trip.
    const now = new Date().toISOString();
    const updateFields: Record<string, any> = { picked: false, picked_at: null, picked_by: '', updated_at: now };
    if (title) updateFields.title = title;
    if (description) updateFields.description = description;
    await db.update(issues).set(updateFields).where(eq(issues.id, taskId));

    // Create the result turn
    const turn = await createTurn(taskId, {
      assigned_to: 'cri',
      content: report,
      links: links || [],
      author: agent,
    });

    return NextResponse.json({
      ok: true,
      turn,
      task: {
        id: taskId,
        title: title || issue.title,
        description: description || issue.description,
        status: issue.status,
      },
    }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/update error');
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}
