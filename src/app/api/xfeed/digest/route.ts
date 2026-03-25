import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { createDigest, updateDigestDiscordInfo } from '@/lib/cc-db';
import { postTweetCard } from '@/lib/discord-cards';
import { db } from '@/db/client';
import { tweets } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_FEED_CHANNEL = '1482408038962036958';
const RATE_LIMIT_DELAY_MS = 600;

interface TweetSummary {
  id: string;
  summary: string;
}

interface DigestRequest {
  label: string;
  brief: string;
  tweet_summaries: TweetSummary[];
  stats: { scraped: number; kept: number; dropped: number };
}

function getBotToken(): string {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN not configured');
  return token;
}

/**
 * POST /api/xfeed/digest
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const body: DigestRequest = await request.json();

    if (!body.label || typeof body.label !== 'string') return NextResponse.json({ error: 'label is required' }, { status: 400 });
    if (!body.brief || typeof body.brief !== 'string') return NextResponse.json({ error: 'brief is required' }, { status: 400 });
    if (!Array.isArray(body.tweet_summaries)) return NextResponse.json({ error: 'tweet_summaries must be an array' }, { status: 400 });
    if (!body.stats || typeof body.stats !== 'object') return NextResponse.json({ error: 'stats object is required' }, { status: 400 });

    // Step 1: Create digest record
    const digest = await createDigest({
      label: body.label,
      brief: body.brief,
      stats_scraped: body.stats.scraped ?? 0,
      stats_kept: body.stats.kept ?? 0,
      stats_dropped: body.stats.dropped ?? 0,
    });

    logger.info({ digestId: digest.id, label: body.label }, 'Digest created');

    // Step 2: Update each tweet's summary and digest_id
    for (const ts of body.tweet_summaries) {
      if (!ts.id || typeof ts.summary !== 'string') continue;
      await db.update(tweets).set({ summary: ts.summary, digest_id: digest.id }).where(eq(tweets.id, ts.id));
    }

    logger.info({ digestId: digest.id, tweetCount: body.tweet_summaries.length }, 'Tweet summaries updated');

    // Step 3: Post brief message to #feed
    const token = getBotToken();
    const statsText = `${body.stats.scraped} scraped → ${body.stats.kept} kept`;
    const briefContent = `📡 **${body.label}** — ${statsText}\n${body.brief}\n\n💬 ${body.tweet_summaries.length} tweets → [thread]`;

    const msgRes = await fetch(`${DISCORD_API}/channels/${DISCORD_FEED_CHANNEL}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: briefContent }),
    });

    if (!msgRes.ok) {
      const err = await msgRes.text();
      logger.error({ status: msgRes.status, err }, 'Failed to post digest brief');
      return NextResponse.json({ error: 'Failed to post brief to Discord' }, { status: 502 });
    }

    const msgData = await msgRes.json();
    const discordMessageId: string = msgData.id;
    logger.info({ digestId: digest.id, messageId: discordMessageId }, 'Digest brief posted');

    // Step 4: Create thread
    const threadName = body.label.length > 100 ? body.label.slice(0, 97) + '...' : body.label;
    const threadRes = await fetch(
      `${DISCORD_API}/channels/${DISCORD_FEED_CHANNEL}/messages/${discordMessageId}/threads`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: threadName, auto_archive_duration: 1440 }),
      }
    );

    if (!threadRes.ok) {
      const err = await threadRes.text();
      logger.error({ status: threadRes.status, err }, 'Failed to create thread');
      return NextResponse.json({ digest_id: digest.id, discord_message_id: discordMessageId, thread_error: 'Failed to create thread' });
    }

    const threadData = await threadRes.json();
    const threadId: string = threadData.id;
    logger.info({ digestId: digest.id, threadId }, 'Thread created');

    // Step 5: Update digest with Discord info
    await updateDigestDiscordInfo(digest.id, discordMessageId, threadId);

    // Step 6: Post tweet cards inside the thread
    const tweetRows = await db.execute(sql`
      SELECT t.*, r.rating FROM tweets t
      LEFT JOIN tweet_ratings r ON t.id = r.tweet_id
      WHERE t.digest_id = ${digest.id}
      ORDER BY t.pinned DESC, t.scraped_at DESC
    `);

    const tweetList = tweetRows.rows as Array<Record<string, unknown>>;
    let postedCount = 0;
    const errors: string[] = [];

    for (const tweet of tweetList) {
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

      const messageId = await postTweetCard(cctweet, threadId, cctweet.rating);

      if (messageId) {
        const now = new Date().toISOString();
        await db.update(tweets).set({ discord_message_id: messageId, discord_posted_at: now }).where(eq(tweets.id, cctweet.id));
        postedCount++;
      } else {
        errors.push(`Failed to post tweet ${tweet.id}`);
      }

      if (tweetList.indexOf(tweet) < tweetList.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }
    }

    logger.info({ digestId: digest.id, postedCount, total: tweetList.length }, 'Tweet cards posted to thread');

    return NextResponse.json({
      digest_id: digest.id,
      discord_message_id: discordMessageId,
      discord_thread_id: threadId,
      cards_posted: postedCount,
      cards_total: tweetList.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/xfeed/digest error');
    return NextResponse.json({ error: 'Failed to create digest' }, { status: 500 });
  }
}
