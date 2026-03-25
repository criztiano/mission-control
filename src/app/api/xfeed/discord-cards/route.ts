import { NextRequest, NextResponse } from 'next/server';
import { postTweetCard } from '@/lib/discord-cards';
import { logger } from '@/lib/logger';
import { db } from '@/db/client';
import { tweets, tweetRatings } from '@/db/schema';
import { eq, isNull, inArray, and, desc, sql } from 'drizzle-orm';

const DISCORD_FEED_CHANNEL = '1482408038962036958';
const RATE_LIMIT_DELAY_MS = 600;

/**
 * POST /api/xfeed/discord-cards
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

    let unpostedRows;
    if (digestId) {
      unpostedRows = await db.execute(sql`
        SELECT t.*, r.rating FROM tweets t
        LEFT JOIN tweet_ratings r ON t.id = r.tweet_id
        WHERE t.digest_id = ${digestId}
          AND t.verdict IN ('curated', 'kept', 'keep')
        ORDER BY t.pinned DESC, t.scraped_at DESC
        LIMIT ${limit}
      `);
    } else {
      unpostedRows = await db.execute(sql`
        SELECT t.*, r.rating FROM tweets t
        LEFT JOIN tweet_ratings r ON t.id = r.tweet_id
        WHERE t.discord_message_id IS NULL
          AND t.verdict IN ('curated', 'kept', 'keep')
        ORDER BY t.pinned DESC, t.scraped_at DESC
        LIMIT ${limit}
      `);
    }

    const unpostedTweets = unpostedRows.rows as Array<Record<string, unknown>>;

    if (unpostedTweets.length === 0) {
      return NextResponse.json({ posted: 0, message: 'No unposted tweets' });
    }

    const targetChannel = channelId || DISCORD_FEED_CHANNEL;
    let postedCount = 0;
    const errors: string[] = [];

    for (const tweet of unpostedTweets) {
      const cctweet = {
        id: String(tweet.id),
        title: String(tweet.title || ''),
        author: String(tweet.author || ''),
        theme: String(tweet.theme || ''),
        verdict: String(tweet.verdict || ''),
        action: String(tweet.action || ''),
        source: String(tweet.source || ''),
        tweet_link: String(tweet.tweet_link || ''),
        digest: String(tweet.digest || ''),
        content: String(tweet.content || ''),
        created_at: String(tweet.created_at || ''),
        scraped_at: String(tweet.scraped_at || ''),
        pinned: Boolean(tweet.pinned),
        media_urls: String(tweet.media_urls || '[]'),
        triage_status: String(tweet.triage_status || ''),
        snooze_until: tweet.snooze_until as string | null,
        rating: tweet.rating as 'fire' | 'meh' | 'noise' | null,
        summary: String(tweet.summary || ''),
        digest_id: String(tweet.digest_id || ''),
        discord_message_id: tweet.discord_message_id as string | null,
        discord_posted_at: tweet.discord_posted_at as string | null,
      };

      const messageId = await postTweetCard(cctweet, targetChannel, cctweet.rating);

      if (messageId) {
        const now = new Date().toISOString();
        await db.update(tweets).set({ discord_message_id: messageId, discord_posted_at: now }).where(eq(tweets.id, cctweet.id));
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
