import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { updateTurn } from '@/lib/cc-db';

/**
 * PUT /api/tasks/[id]/turns/[turnId] — edit a note's content
 * Only notes can be edited. Updates content + updated_at.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; turnId: string }> }
) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const { turnId } = await params;
    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    updateTurn(turnId, content.trim());

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/tasks/[id]/turns/[turnId] error');
    return NextResponse.json({ error: 'Failed to update turn' }, { status: 500 });
  }
}
