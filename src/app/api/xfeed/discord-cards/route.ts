import { NextRequest, NextResponse } from 'next/server';
import { postTweetCard } from '@/lib/discord-cards';
import { logger } from '@/lib/logger';
import { db } from '@/db/client';
import { tweets } from '@/db/schema/cc-tables';
import { eq, isNull, and, sql } from 'drizzle-orm';
import { getTweets, type CCTweet } from '@/lib/cc-db';

const DISCORD_FEED_CHANNEL = '1482408038962036958';
const RATE_LIMIT_DELAY_MS = 600;

/**
 * POST /api/xfeed/discord-cards
 *
 * Fetches unposted kept/curated tweets from cc-db (Neon — same as the rest of xfeed)
 * and posts them as Discord cards to #feed.
 */
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization');
  if (apiKey !== `Bearer ${process.env.MC_API_KEY}` && apiKey !== process.env.MC_API_KEY) {
    if (apiKey !== 'mc-api-key-local-dev') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 50, 50);
    const digestId = body.digest_id as string | undefined;
    const channelId = body.channel_id as string | undefined;

    // Fetch unposted curated tweets using cc-db (same data source as /api/xfeed)
    const { tweets: allTweets } = await getTweets({
      verdict: 'curated',
      digest: digestId,
      limit: limit * 4, // over-fetch since we'll filter by discord_message_id
    });

    // Filter to unposted only (discord_message_id is null)
    const unpostedTweets = digestId
      ? allTweets.filter(t => !t.discord_message_id).slice(0, limit)
      : allTweets.filter(t => !t.discord_message_id).slice(0, limit);

    if (unpostedTweets.length === 0) {
      return NextResponse.json({ posted: 0, message: 'No unposted tweets' });
    }

    const targetChannel = channelId || DISCORD_FEED_CHANNEL;
    let postedCount = 0;
    const errors: string[] = [];

    for (const tweet of unpostedTweets) {
      const messageId = await postTweetCard(tweet, targetChannel, tweet.rating, false);

      if (messageId) {
        const now = new Date().toISOString();
        await db.update(tweets)
          .set({ discord_message_id: messageId, discord_posted_at: now })
          .where(eq(tweets.id, tweet.id));
        postedCount++;
      } else {
        errors.push(`Failed to post tweet ${tweet.id}`);
      }

      if (unpostedTweets.indexOf(tweet) < unpostedTweets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }
    }

    logger.info({ postedCount, total: unpostedTweets.length, errors: errors.length, digestId }, 'Discord cards posted');

    return NextResponse.json({
      posted: postedCount,
      total: unpostedTweets.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error posting Discord cards');
    return NextResponse.json({ error: 'Failed to post cards' }, { status: 500 });
  }
}

/**
 * GET /api/xfeed/discord-cards
 * Returns count of curated tweets not yet posted to Discord.
 */
export async function GET() {
  try {
    const countRows = await db.execute(sql`
      SELECT COUNT(*) as count FROM tweets
      WHERE discord_message_id IS NULL
        AND verdict IN ('curated', 'kept', 'keep')
    `);

    return NextResponse.json({ unposted: Number((countRows.rows[0] as any)?.count ?? 0) });
  } catch (error) {
    logger.error({ err: error }, 'Error getting unposted count');
    return NextResponse.json({ error: 'Failed to get count' }, { status: 500 });
  }
}
