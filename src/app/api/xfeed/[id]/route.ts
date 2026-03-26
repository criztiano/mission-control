import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { rateTweet, pinTweet, triageUpdate, updateTweetSummary } from '@/lib/cc-db';

/**
 * PUT /api/xfeed/[id] - Rate, pin, triage, or summarize a tweet
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const { id } = await params;
    const body = await request.json();

    if ('rating' in body) {
      const { rating } = body;
      if (rating !== null && !['fire', 'meh', 'noise'].includes(rating)) {
        return NextResponse.json({ error: 'Invalid rating' }, { status: 400 });
      }
      await rateTweet(id, rating);
    }

    if ('pinned' in body) {
      await pinTweet(id, !!body.pinned);
    }

    if ('triage_status' in body) {
      await triageUpdate(id, body.triage_status);
    }

    if ('summary' in body) {
      const { summary } = body;
      if (typeof summary !== 'string') {
        return NextResponse.json({ error: 'Summary must be a string' }, { status: 400 });
      }
      await updateTweetSummary(id, summary);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/xfeed/[id] error');
    return NextResponse.json({ error: 'Failed to update tweet' }, { status: 500 });
  }
}
