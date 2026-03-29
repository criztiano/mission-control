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
  // Optional full tweet data — when provided, cards are posted from payload
  // instead of querying Neon (supports local-SQLite → Vercel pipeline)
  author?: string;
  content?: string;
  tweet_link?: string;
  theme?: string;
  verdict?: string;
  created_at?: string;
  scraped_at?: string;
  media_urls?: string;
  like_count?: number;
  reply_count?: number;
  retweet_count?: number;
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

    // Step 2: Upsert each tweet — insert if not in Neon, update if exists
    for (const ts of body.tweet_summaries) {
      if (!ts.id || typeof ts.summary !== 'string') continue;
      const now = new Date().toISOString();
      await db
        .insert(tweets)
        .values({
          id: ts.id,
          author: ts.author || '',
          content: ts.content || '',
          summary: ts.summary,
          digest_id: digest.id,
          tweet_link: ts.tweet_link || '',
          theme: ts.theme || '',
          retweet_count: ts.retweet_count || 0,
          reply_count: ts.reply_count || 0,
          like_count: ts.like_count || 0,
          created_at: now,
          scraped_at: now,
        })
        .onConflictDoUpdate({
          target: tweets.id,
          set: { summary: ts.summary, digest_id: digest.id },
        });
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
    // Use payload data directly (supports local-SQLite pipeline where tweets aren't in Neon)
    const hasPayloadData = body.tweet_summaries.some(ts => ts.author && ts.content);
    let tweetCards: Array<{
      id: string; title: string; author: string; theme: string; verdict: string;
      action: string; source: string; tweet_link: string; digest: string; content: string;
      created_at: string; scraped_at: string; pinned: boolean; media_urls: string;
      triage_status: string; snooze_until: string | null; rating: 'fire' | 'meh' | 'noise' | null;
      summary: string; digest_id: string; discord_message_id: string | null; discord_posted_at: string | null;
    }> = [];

    if (hasPayloadData) {
      // Build cards from payload — no Neon query needed
      tweetCards = body.tweet_summaries
        .filter(ts => ts.author && ts.content)
        .map(ts => ({
          id: ts.id,
          title: '',
          author: ts.author || '',
          theme: ts.theme || '',
          verdict: ts.verdict || 'keep',
          action: '',
          source: '',
          tweet_link: ts.tweet_link || '',
          digest: body.label,
          content: ts.content || '',
          created_at: ts.created_at || '',
          scraped_at: ts.scraped_at || '',
          pinned: false,
          media_urls: ts.media_urls || '[]',
          triage_status: 'classified',
          snooze_until: null,
          rating: null,
          summary: ts.summary,
          digest_id: digest.id,
          discord_message_id: null,
          discord_posted_at: null,
        }));
      logger.info({ digestId: digest.id, source: 'payload', count: tweetCards.length }, 'Using payload tweet data for cards');
    } else {
      // Fallback: query Neon (works when tweets are in the DB)
      const tweetRows = await db.execute(sql`
        SELECT t.*, r.rating FROM tweets t
        LEFT JOIN tweet_ratings r ON t.id = r.tweet_id
        WHERE t.digest_id = ${digest.id}
        ORDER BY t.pinned DESC, t.scraped_at DESC
      `);
      tweetCards = (tweetRows.rows as Array<Record<string, unknown>>).map(tweet => ({
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
      }));
      logger.info({ digestId: digest.id, source: 'neon', count: tweetCards.length }, 'Using Neon tweet data for cards');
    }

    let postedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < tweetCards.length; i++) {
      const cctweet = tweetCards[i];
      const messageId = await postTweetCard(cctweet, threadId, cctweet.rating, false);

      if (messageId) {
        postedCount++;
      } else {
        errors.push(`Failed to post tweet ${cctweet.id}`);
      }

      if (i < tweetCards.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }
    }

    logger.info({ digestId: digest.id, postedCount, total: tweetCards.length }, 'Tweet cards posted to thread');

    return NextResponse.json({
      digest_id: digest.id,
      discord_message_id: discordMessageId,
      discord_thread_id: threadId,
      cards_posted: postedCount,
      cards_total: tweetCards.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/xfeed/digest error');
    return NextResponse.json({ error: 'Failed to create digest' }, { status: 500 });
  }
}
