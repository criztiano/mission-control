import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  createDigest,
  updateDigestDiscordInfo,
  updateTweetSummary,
  getCCDatabaseWrite,
} from '@/lib/cc-db';
import { postTweetCard } from '@/lib/discord-cards';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_FEED_CHANNEL = '1482408038962036958'; // #feed channel
const RATE_LIMIT_DELAY_MS = 600;

interface TweetSummary {
  id: string;
  summary: string;
}

interface DigestRequest {
  label: string;
  brief: string;
  tweet_summaries: TweetSummary[];
  stats: {
    scraped: number;
    kept: number;
    dropped: number;
  };
}

function getBotToken(): string {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN not configured');
  return token;
}

/**
 * POST /api/xfeed/digest
 *
 * Worm calls this after processing a scrape batch.
 * 1. Creates a digest record
 * 2. Updates each tweet's summary and digest_id
 * 3. Posts the brief as a channel message to #feed
 * 4. Creates a thread on that message
 * 5. Posts individual tweet cards inside the thread
 * 6. Updates digest record with discord_message_id and discord_thread_id
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const body: DigestRequest = await request.json();

    // Validate required fields
    if (!body.label || typeof body.label !== 'string') {
      return NextResponse.json({ error: 'label is required' }, { status: 400 });
    }
    if (!body.brief || typeof body.brief !== 'string') {
      return NextResponse.json({ error: 'brief is required' }, { status: 400 });
    }
    if (!Array.isArray(body.tweet_summaries)) {
      return NextResponse.json({ error: 'tweet_summaries must be an array' }, { status: 400 });
    }
    if (!body.stats || typeof body.stats !== 'object') {
      return NextResponse.json({ error: 'stats object is required' }, { status: 400 });
    }

    // Step 1: Create digest record
    const digest = createDigest({
      label: body.label,
      brief: body.brief,
      stats_scraped: body.stats.scraped ?? 0,
      stats_kept: body.stats.kept ?? 0,
      stats_dropped: body.stats.dropped ?? 0,
    });

    logger.info({ digestId: digest.id, label: body.label }, 'Digest created');

    // Step 2: Update each tweet's summary and digest_id
    const writeDb = getCCDatabaseWrite();
    try {
      for (const ts of body.tweet_summaries) {
        if (!ts.id || typeof ts.summary !== 'string') continue;
        writeDb.prepare(
          'UPDATE tweets SET summary = ?, digest_id = ? WHERE id = ?'
        ).run(ts.summary, digest.id, ts.id);
      }
    } finally {
      writeDb.close();
    }

    logger.info(
      { digestId: digest.id, tweetCount: body.tweet_summaries.length },
      'Tweet summaries updated'
    );

    // Step 3: Post brief message to #feed
    const token = getBotToken();
    const statsText = `${body.stats.scraped} scraped → ${body.stats.kept} kept`;
    const briefContent = `📡 **${body.label}** — ${statsText}\n${body.brief}\n\n💬 ${body.tweet_summaries.length} tweets → [thread]`;

    const msgRes = await fetch(`${DISCORD_API}/channels/${DISCORD_FEED_CHANNEL}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json',
      },
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

    // Step 4: Create thread on the brief message
    const threadName = body.label.length > 100 ? body.label.slice(0, 97) + '...' : body.label;
    const threadRes = await fetch(
      `${DISCORD_API}/channels/${DISCORD_FEED_CHANNEL}/messages/${discordMessageId}/threads`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: threadName,
          auto_archive_duration: 1440, // 24 hours
        }),
      }
    );

    if (!threadRes.ok) {
      const err = await threadRes.text();
      logger.error({ status: threadRes.status, err }, 'Failed to create thread');
      // Still return success — brief was posted, thread creation is best-effort
      return NextResponse.json({
        digest_id: digest.id,
        discord_message_id: discordMessageId,
        thread_error: 'Failed to create thread',
      });
    }

    const threadData = await threadRes.json();
    const threadId: string = threadData.id;
    logger.info({ digestId: digest.id, threadId }, 'Thread created');

    // Step 5: Update digest with Discord info
    updateDigestDiscordInfo(digest.id, discordMessageId, threadId);

    // Step 6: Post tweet cards inside the thread
    // Fetch the updated tweets with their summaries
    const cardDb = getCCDatabaseWrite();
    try {
      const tweets = cardDb.prepare(`
        SELECT t.*, r.rating FROM tweets t
        LEFT JOIN tweet_ratings r ON t.id = r.tweet_id
        WHERE t.digest_id = ?
        ORDER BY t.pinned DESC, t.scraped_at DESC
      `).all(digest.id) as Array<Record<string, unknown>>;

      let postedCount = 0;
      const errors: string[] = [];

      for (const tweet of tweets) {
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
          pinned: Number(tweet.pinned || 0),
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
          cardDb.prepare(
            'UPDATE tweets SET discord_message_id = ?, discord_posted_at = ? WHERE id = ?'
          ).run(messageId, now, tweet.id);
          postedCount++;
        } else {
          errors.push(`Failed to post tweet ${tweet.id}`);
        }

        // Rate limit between posts
        if (tweets.indexOf(tweet) < tweets.length - 1) {
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
        }
      }

      logger.info(
        { digestId: digest.id, postedCount, total: tweets.length },
        'Tweet cards posted to thread'
      );

      return NextResponse.json({
        digest_id: digest.id,
        discord_message_id: discordMessageId,
        discord_thread_id: threadId,
        cards_posted: postedCount,
        cards_total: tweets.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } finally {
      cardDb.close();
    }
  } catch (error) {
    logger.error({ err: error }, 'POST /api/xfeed/digest error');
    return NextResponse.json({ error: 'Failed to create digest' }, { status: 500 });
  }
}
