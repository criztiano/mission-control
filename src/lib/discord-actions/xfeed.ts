import { rateTweet, type TweetRating } from '@/lib/cc-db';
import { buildTweetCardV2 } from '@/lib/discord-cards';
import { db } from '@/db/client';
import { tweets, tweetRatings, issues } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';

interface XFeedActionResult {
  success: boolean;
  ephemeralMessage: string;
  updateCard?: boolean;
  newRating?: TweetRating | null;
}

interface XFeedHighlightResult {
  success: boolean;
  ephemeralMessage: string;
  updateCard?: boolean;
  highlighted: boolean;
}

interface XFeedModalResult {
  success: boolean;
  ephemeralMessage: string;
}

/**
 * Handle a rating button click (fire/meh/noise).
 * Toggles the rating: if already rated with same rating, removes it; otherwise sets it.
 */
export async function handleXFeedRating(
  rating: TweetRating,
  tweetId: string
): Promise<XFeedActionResult> {
  const tweetRows = await db.select().from(tweets).where(eq(tweets.id, tweetId)).limit(1);
  if (!tweetRows[0]) {
    return { success: false, ephemeralMessage: '❌ Tweet not found.' };
  }

  // Check current rating
  const ratingRows = await db.select().from(tweetRatings).where(eq(tweetRatings.tweet_id, tweetId)).limit(1);
  const currentRating = ratingRows[0];

  if (currentRating?.rating === rating) {
    // Toggle off — remove rating
    await rateTweet(tweetId, null);
    logger.info({ tweetId, rating }, 'Tweet rating removed via Discord');
  } else {
    // Set new rating
    await rateTweet(tweetId, rating);
    logger.info({ tweetId, rating }, 'Tweet rated via Discord');
  }

  const emojiMap: Record<TweetRating, string> = {
    fire: '🔥',
    meh: '😐',
    noise: '🗑️',
  };

  const isToggleOff = currentRating?.rating === rating;
  const message = isToggleOff
    ? `Rating removed`
    : `${emojiMap[rating]} Rated as ${rating}`;

  return {
    success: true,
    ephemeralMessage: message,
    updateCard: true,
    newRating: isToggleOff ? null : rating,
  };
}

/**
 * Handle "Create Task" button click — returns modal definition.
 */
export async function getXFeedTaskModal(tweetId: string): Promise<{
  title: string;
  components: Array<{
    type: number;
    components: Array<{
      type: number;
      custom_id: string;
      label: string;
      style: number;
      value?: string;
      placeholder?: string;
      required?: boolean;
      max_length?: number;
    }>;
  }>;
} | null> {
  const rows = await db.select().from(tweets).where(eq(tweets.id, tweetId)).limit(1);
  const tweet = rows[0];
  if (!tweet) return null;

  const author = tweet.author || 'Unknown';
  const content = (tweet.content || '').slice(0, 50);

  return {
    title: 'Create task from tweet',
    components: [
      {
        type: 1, // Action Row
        components: [
          {
            type: 4, // TextInput
            custom_id: `xfeed_task_title`,
            label: 'Task Title',
            style: 1, // Short
            value: `${author}: ${content}`,
            required: true,
            max_length: 100,
          },
        ],
      },
      {
        type: 1, // Action Row
        components: [
          {
            type: 4, // TextInput
            custom_id: `xfeed_task_description`,
            label: 'Description',
            style: 2, // Paragraph
            placeholder: 'Describe what needs to be done...',
            required: false,
            max_length: 1000,
          },
        ],
      },
    ],
  };
}

/**
 * Handle modal submit — create a task from tweet.
 */
export async function handleXFeedTaskModalSubmit(
  tweetId: string,
  title: string,
  description: string
): Promise<XFeedModalResult> {
  const tweetRows = await db.select().from(tweets).where(eq(tweets.id, tweetId)).limit(1);
  const tweet = tweetRows[0];
  if (!tweet) {
    return { success: false, ephemeralMessage: '❌ Tweet not found.' };
  }

  const tweetLink = tweet.tweet_link || '';
  const fullDescription = description
    ? `${description}\n\n---\n**Source:** ${tweetLink}`
    : `Task created from tweet by ${tweet.author}\n\n**Source:** ${tweetLink}`;

  const taskId = randomUUID();
  const now = new Date().toISOString();

  await db.insert(issues).values({
    id: taskId,
    title,
    description: fullDescription,
    status: 'open',
    assignee: 'cseno',
    creator: 'eden',
    priority: 'normal',
    created_at: now,
    updated_at: now,
    archived: false,
  });

  logger.info({ taskId, tweetId, title }, 'Task created from tweet via Discord');

  return {
    success: true,
    ephemeralMessage: '✅ Task created — Cseno will route it',
  };
}

/**
 * Handle highlight button — toggle highlight on a tweet.
 * Signals Uze to cover this topic (cover post or quote tweet, Uze decides).
 */
export async function handleXFeedHighlight(
  tweetId: string
): Promise<XFeedHighlightResult> {
  const tweetRows = await db.select().from(tweets).where(eq(tweets.id, tweetId)).limit(1);
  const tweet = tweetRows[0];
  if (!tweet) {
    return { success: false, ephemeralMessage: '❌ Tweet not found.', highlighted: false };
  }

  const currentHighlight = !!tweet.highlighted;
  const newHighlight = !currentHighlight;

  await db.update(tweets).set({ highlighted: newHighlight }).where(eq(tweets.id, tweetId));
  logger.info({ tweetId, highlighted: newHighlight }, 'Tweet highlight toggled via Discord');

  const message = newHighlight
    ? '⭐ Highlighted for Uze — he\'ll decide to cover or quote'
    : 'Highlight removed';

  return {
    success: true,
    ephemeralMessage: message,
    updateCard: true,
    highlighted: newHighlight,
  };
}

/**
 * Build modal for "Highlight + Note" — lets Cri add direction for Uze.
 */
export async function getXFeedHighlightNoteModal(tweetId: string): Promise<{
  title: string;
  components: Array<{
    type: number;
    components: Array<{
      type: number;
      custom_id: string;
      label: string;
      style: number;
      value?: string;
      placeholder?: string;
      required?: boolean;
      max_length?: number;
    }>;
  }>;
} | null> {
  const tweetRows = await db.select().from(tweets).where(eq(tweets.id, tweetId)).limit(1);
  if (!tweetRows[0]) return null;

  return {
    title: 'Highlight + Note for Uze',
    components: [
      {
        type: 1,
        components: [
          {
            type: 4, // TextInput
            custom_id: 'xfeed_highlight_note',
            label: 'Note for Uze',
            style: 2, // Paragraph
            placeholder: 'e.g. "focus on the AI angle", "quote tweet with our take on this"',
            required: false,
            max_length: 500,
          },
        ],
      },
    ],
  };
}

/**
 * Handle "Highlight + Note" modal submit.
 */
export async function handleXFeedHighlightNoteSubmit(
  tweetId: string,
  note: string
): Promise<XFeedModalResult> {
  const tweetRows = await db.select().from(tweets).where(eq(tweets.id, tweetId)).limit(1);
  if (!tweetRows[0]) {
    return { success: false, ephemeralMessage: '❌ Tweet not found.' };
  }

  await db.update(tweets).set({ highlighted: true, highlight_note: note || '' }).where(eq(tweets.id, tweetId));
  logger.info({ tweetId, note: note?.slice(0, 50) }, 'Tweet highlighted with note via Discord');

  return {
    success: true,
    ephemeralMessage: `⭐✏️ Highlighted with note${note ? `: "${note.slice(0, 60)}..."` : ''}`,
  };
}
