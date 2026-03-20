import { getCCDatabase, getCCDatabaseWrite, rateTweet, type TweetRating } from '@/lib/cc-db';
import { buildTweetCardV2 } from '@/lib/discord-cards';
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
  updateCard?: boolean;
}

/**
 * Handle a rating button click (fire/meh/noise).
 * Toggles the rating: if already rated with same rating, removes it; otherwise sets it.
 */
export function handleXFeedRating(
  rating: TweetRating,
  tweetId: string
): XFeedActionResult {
  const db = getCCDatabase();

  const tweet = db.prepare('SELECT * FROM tweets WHERE id = ?').get(tweetId) as Record<string, unknown> | undefined;
  if (!tweet) {
    return { success: false, ephemeralMessage: '❌ Tweet not found.' };
  }

  // Check current rating
  const currentRating = db.prepare(
    'SELECT rating FROM tweet_ratings WHERE tweet_id = ?'
  ).get(tweetId) as { rating: string } | undefined;

  if (currentRating?.rating === rating) {
    // Toggle off — remove rating
    rateTweet(tweetId, null);
    logger.info({ tweetId, rating }, 'Tweet rating removed via Discord');
  } else {
    // Set new rating
    rateTweet(tweetId, rating);
    logger.info({ tweetId, rating }, 'Tweet rated via Discord');
  }

  const emojiMap: Record<string, string> = {
    fire: '🔥',
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
 * The caller (interaction route) will return RESPONSE_MODAL with this payload.
 */
export function getXFeedTaskModal(tweetId: string): {
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
} | null {
  const db = getCCDatabase();
  const tweet = db.prepare('SELECT * FROM tweets WHERE id = ?').get(tweetId) as Record<string, unknown> | undefined;
  if (!tweet) return null;

  const author = String(tweet.author || 'Unknown');
  const content = String(tweet.content || '').slice(0, 50);

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
export function handleXFeedTaskModalSubmit(
  tweetId: string,
  title: string,
  description: string
): XFeedModalResult {
  const db = getCCDatabase();
  const tweet = db.prepare('SELECT * FROM tweets WHERE id = ?').get(tweetId) as Record<string, unknown> | undefined;
  if (!tweet) {
    return { success: false, ephemeralMessage: '❌ Tweet not found.' };
  }

  const tweetLink = String(tweet.tweet_link || '');
  const fullDescription = description
    ? `${description}\n\n---\n**Source:** ${tweetLink}`
    : `Task created from tweet by ${tweet.author}\n\n**Source:** ${tweetLink}`;

  const writeDb = getCCDatabaseWrite();
  try {
    const taskId = randomUUID();
    const now = new Date().toISOString();

    writeDb.prepare(`
      INSERT INTO issues (id, title, description, status, assignee, creator, priority, created_at, updated_at, archived)
      VALUES (?, ?, ?, 'open', 'cseno', 'eden', 'normal', ?, ?, 0)
    `).run(taskId, title, fullDescription, now, now);

    logger.info({ taskId, tweetId, title }, 'Task created from tweet via Discord');
  } finally {
    writeDb.close();
  }

  return {
    success: true,
    ephemeralMessage: '✅ Task created — Cseno will route it',
  };
}

/**
 * Handle highlight button — toggle highlight on a tweet.
 * Signals Uze to cover this topic (cover post or quote tweet, Uze decides).
 */
export function handleXFeedHighlight(
  tweetId: string
): XFeedHighlightResult {
  const db = getCCDatabase();
  const tweet = db.prepare('SELECT * FROM tweets WHERE id = ?').get(tweetId) as Record<string, unknown> | undefined;
  if (!tweet) {
    return { success: false, ephemeralMessage: '❌ Tweet not found.', highlighted: false };
  }

  const currentHighlight = Number(tweet.highlighted || 0);
  const newHighlight = currentHighlight ? 0 : 1;

  const writeDb = getCCDatabaseWrite();
  try {
    writeDb.prepare('UPDATE tweets SET highlighted = ? WHERE id = ?').run(newHighlight, tweetId);
    logger.info({ tweetId, highlighted: newHighlight }, 'Tweet highlight toggled via Discord');
  } finally {
    writeDb.close();
  }

  const message = newHighlight
    ? '⭐ Highlighted for Uze — he\'ll decide to cover or quote'
    : 'Highlight removed';

  return {
    success: true,
    ephemeralMessage: message,
    updateCard: true,
    highlighted: !!newHighlight,
  };
}

/**
 * Build modal for "Highlight + Note" — lets Cri add direction for Uze.
 */
export function getXFeedHighlightNoteModal(tweetId: string): {
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
} | null {
  const db = getCCDatabase();
  const tweet = db.prepare('SELECT * FROM tweets WHERE id = ?').get(tweetId) as Record<string, unknown> | undefined;
  if (!tweet) return null;

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
            placeholder: 'e.g. "focus on the AI angle", "quote tweet with our take on this", "cover but from crypto perspective"',
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
export function handleXFeedHighlightNoteSubmit(
  tweetId: string,
  note: string
): XFeedModalResult {
  const db = getCCDatabase();
  const tweet = db.prepare('SELECT * FROM tweets WHERE id = ?').get(tweetId) as Record<string, unknown> | undefined;
  if (!tweet) {
    return { success: false, ephemeralMessage: '❌ Tweet not found.' };
  }

  const writeDb = getCCDatabaseWrite();
  try {
    writeDb.prepare('UPDATE tweets SET highlighted = 1, highlight_note = ? WHERE id = ?').run(note || '', tweetId);
    logger.info({ tweetId, note: note?.slice(0, 50) }, 'Tweet highlighted with note via Discord');
  } finally {
    writeDb.close();
  }

  return {
    success: true,
    ephemeralMessage: `⭐✏️ Highlighted with note${note ? `: "${note.slice(0, 60)}..."` : ''}`,
    updateCard: true,
  };
}
