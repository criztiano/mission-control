import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getIssue, getTurns, createTurn, getCCDatabaseWrite } from '@/lib/cc-db';

/**
 * POST /api/tasks/[id]/update — agent delivers work on a task
 *
 * Body: {
 *   agent: string        (required — who's updating)
 *   report: string       (required — what was done, becomes a 'result' turn)
 *   links?: Array<{ url: string; title?: string; type?: string }>
 *   title?: string       (optional — refine the task title)
 *   description?: string (optional — refine the task description)
 * }
 *
 * Rules:
 * - If the task has no turns AND no description, title + description are REQUIRED
 *   (forces refinement on first touch).
 * - Creates a 'result' turn with the report content.
 * - If title/description are provided, updates the task itself.
 * - Does NOT change task status — that's a human action.
 * - Resets picked state (agent is done, ball is passed).
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

    const { agent, report, links, title, description } = body;

    // Validate agent
    if (!agent || typeof agent !== 'string') {
      return NextResponse.json(
        { error: 'agent is required — identify yourself' },
        { status: 400 }
      );
    }

    // Validate report
    if (!report || typeof report !== 'string' || report.trim().length === 0) {
      return NextResponse.json(
        { error: 'report is required — describe what you did' },
        { status: 400 }
      );
    }

    const issue = getIssue(taskId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const existingTurns = getTurns(taskId);
    const hasDescription = issue.description && issue.description.trim().length > 0;

    // Enforce refinement on first touch
    if (existingTurns.length === 0 && !hasDescription) {
      if (!title || !description) {
        return NextResponse.json(
          { error: 'First update on a task without description requires title and description (refinement)' },
          { status: 400 }
        );
      }
    }

    // Update title/description if provided
    if (title || description) {
      const writeDb = getCCDatabaseWrite();
      try {
        const now = new Date().toISOString();
        const updates: string[] = [];
        const values: (string)[] = [];

        if (title) {
          updates.push('title = ?');
          values.push(title);
        }
        if (description) {
          updates.push('description = ?');
          values.push(description);
        }
        updates.push('updated_at = ?');
        values.push(now);
        values.push(taskId);

        writeDb.prepare(
          `UPDATE issues SET ${updates.join(', ')} WHERE id = ?`
        ).run(...values);
      } finally {
        writeDb.close();
      }
    }

    // Create the result turn
    const turn = createTurn(taskId, {
      type: 'result',
      author: agent,
      content: report,
      links: links || [],
    });

    // Reset picked state (ball is passed)
    const writeDb = getCCDatabaseWrite();
    try {
      writeDb.prepare(
        'UPDATE issues SET picked = 0, picked_at = NULL, picked_by = ? WHERE id = ?'
      ).run('', taskId);
    } finally {
      writeDb.close();
    }

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
