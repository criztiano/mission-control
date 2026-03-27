import { NextRequest, NextResponse } from 'next/server';
import { db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  getIssue,
  getIssueComments,
  mapCCComment,
} from '@/lib/cc-db';
import { db } from '@/db/client';
import { issueComments } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * GET /api/tasks/[id]/comments - Get all comments for an issue
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id: issueId } = await params;

    const [issue, rawComments] = await Promise.all([getIssue(issueId), getIssueComments(issueId)]);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const comments = rawComments.map(mapCCComment);

    return NextResponse.json({ comments, total: comments.length });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id]/comments error');
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
  }
}

/**
 * POST /api/tasks/[id]/comments - Add a comment to an issue
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
    const { id: issueId } = await params;
    const body = await request.json();

    const { content, author = 'system', attachments } = body;

    if ((!content || typeof content !== 'string' || content.trim().length === 0) && (!attachments || attachments.length === 0)) {
      return NextResponse.json({ error: 'Comment content or attachments are required' }, { status: 400 });
    }

    const issue = await getIssue(issueId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const attachmentsJson = attachments ? JSON.stringify(attachments) : '[]';

    await db.insert(issueComments).values({
      id,
      issue_id: issueId,
      author,
      content: content || '',
      created_at: now,
      attachments: attachmentsJson,
    });

    const mentions = db_helpers.parseMentions(content || '');

    await db_helpers.logActivity(
      'comment_added',
      'comment',
      0,
      author,
      `Added comment to task: ${issue.title}`,
      { task_id: issueId, task_title: issue.title, content_preview: (content || '').substring(0, 100) }
    );

    const comment = {
      id,
      task_id: issueId,
      author,
      content: content || '',
      created_at: Math.floor(new Date(now).getTime() / 1000),
      mentions,
      replies: [],
      attachments: attachments || [],
    };

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/comments error');
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}

/**
 * PUT /api/tasks/[id]/comments - Edit a comment
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id: issueId } = await params;
    const body = await request.json();
    const { commentId, content } = body;

    if (!commentId || !content?.trim()) {
      return NextResponse.json({ error: 'commentId and content required' }, { status: 400 });
    }

    const result = await db
      .update(issueComments)
      .set({ content: content.trim() })
      .where(and(eq(issueComments.id, commentId), eq(issueComments.issue_id, issueId)));

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/tasks/[id]/comments error');
    return NextResponse.json({ error: 'Failed to edit comment' }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks/[id]/comments - Delete a comment
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id: issueId } = await params;
    const body = await request.json();
    const { commentId } = body;

    if (!commentId) {
      return NextResponse.json({ error: 'commentId required' }, { status: 400 });
    }

    await db
      .delete(issueComments)
      .where(and(eq(issueComments.id, commentId), eq(issueComments.issue_id, issueId)));

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/tasks/[id]/comments error');
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 });
  }
}
