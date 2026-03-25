import { NextRequest, NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import { logger } from '@/lib/logger';
import { handleGardenPin, handleGardenSnooze, handleGardenDismiss } from '@/lib/discord-actions/garden';
import { handleXFeedRating, getXFeedTaskModal, handleXFeedTaskModalSubmit, handleXFeedHighlight, getXFeedHighlightNoteModal, handleXFeedHighlightNoteSubmit } from '@/lib/discord-actions/xfeed';
import { type TweetRating } from '@/lib/cc-db';
import { db as drizzleDb } from '@/db/client';
import { tweets as tweetsTable, tweetRatings as tweetRatingsTable, garden as gardenTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { buildGardenEmbed, buildGardenButtons, buildTweetCardV2 } from '@/lib/discord-cards';

// Discord interaction types
const INTERACTION_PING = 1;
const INTERACTION_MESSAGE_COMPONENT = 3;
const INTERACTION_MODAL_SUBMIT = 5;

// Discord response types
const RESPONSE_PONG = 1;
const RESPONSE_CHANNEL_MESSAGE = 4;
const RESPONSE_UPDATE_MESSAGE = 7;
const RESPONSE_MODAL = 9;

/**
 * Verify Discord ed25519 signature.
 */
function verifySignature(
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string
): boolean {
  try {
    const key = Buffer.from(publicKey, 'hex');
    const sig = Buffer.from(signature, 'hex');
    const msg = Buffer.from(timestamp + body);
    return nacl.sign.detached.verify(msg, sig, key);
  } catch {
    return false;
  }
}

/**
 * Parse custom_id into domain, action, and item ID.
 * Format: {domain}_{action}_{itemId}
 */
function parseCustomId(customId: string): { domain: string; action: string; itemId: string } | null {
  const parts = customId.split('_');
  if (parts.length < 3) return null;

  const domain = parts[0];
  const action = parts[1];
  // itemId can contain underscores, so rejoin the rest
  const itemId = parts.slice(2).join('_');

  return { domain, action, itemId };
}

/**
 * Handle garden component interactions (Pin, Snooze, Dismiss).
 */
async function handleGardenAction(
  action: string,
  itemId: string
): Promise<{ ephemeralMessage: string; embedUpdate?: Record<string, unknown>; success: boolean }> {
  switch (action) {
    case 'pin':
      return await handleGardenPin(itemId);
    case 'snooze':
      return await handleGardenSnooze(itemId);
    case 'dismiss':
      return await handleGardenDismiss(itemId);
    default:
      return { success: false, ephemeralMessage: `❌ Unknown garden action: ${action}` };
  }
}

/**
 * POST /api/discord/interactions
 * Handles Discord interaction payloads (PING verification + button clicks).
 */
export async function POST(request: NextRequest) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    logger.error('DISCORD_PUBLIC_KEY not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  // Read raw body for signature verification
  const rawBody = await request.text();
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  logger.info({ hasSig: !!signature, hasTs: !!timestamp, bodyLen: rawBody.length }, 'Discord interaction received');

  // Verify signature (skip only if no signature headers — for testing)
  if (signature && timestamp) {
    const isValid = verifySignature(rawBody, signature, timestamp, publicKey);
    if (!isValid) {
      logger.warn('Invalid Discord signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const interactionType = body.type as number;

  // Type 1: PING — Discord endpoint verification
  if (interactionType === INTERACTION_PING) {
    return NextResponse.json({ type: RESPONSE_PONG });
  }

  // Type 3: MESSAGE_COMPONENT — button click
  if (interactionType === INTERACTION_MESSAGE_COMPONENT) {
    const data = body.data as Record<string, unknown> | undefined;
    const customId = (data?.custom_id || body.custom_id) as string;
    const parsed = parseCustomId(customId);

    if (!parsed) {
      return NextResponse.json({
        type: RESPONSE_CHANNEL_MESSAGE,
        data: { content: '❌ Invalid interaction', flags: 64 },
      });
    }

    const { domain, action, itemId } = parsed;

    // Handle X Feed domain
    if (domain === 'xfeed') {
      if (action === 'task') {
        // "Create Task" button — show modal
        const modal = await getXFeedTaskModal(itemId);
        if (!modal) {
          return NextResponse.json({
            type: RESPONSE_CHANNEL_MESSAGE,
            data: { content: '❌ Tweet not found', flags: 64 },
          });
        }
        return NextResponse.json({
          type: RESPONSE_MODAL,
          data: {
            ...modal,
            custom_id: `xfeed_taskmodal_${itemId}`,
          },
        });
      }

      // Rating buttons (fire/meh/noise)
      if (['fire', 'meh', 'noise'].includes(action)) {
        const result = await handleXFeedRating(action as TweetRating, itemId);

        if (!result.success) {
          return NextResponse.json({
            type: RESPONSE_CHANNEL_MESSAGE,
            data: { content: result.ephemeralMessage, flags: 64 },
          });
        }

        if (result.updateCard) {
          // Rebuild the card with updated button states
          // Use newRating from the handler directly (avoids read-after-write race)
          const tweetRows = await drizzleDb.select().from(tweetsTable).where(eq(tweetsTable.id, itemId)).limit(1);
          const tweet = tweetRows[0] as Record<string, unknown> | undefined;

          if (tweet) {
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
              rating: null, // ignored — we use newRating below
              summary: String(tweet.summary || ''),
              digest_id: (tweet.digest_id as string | null) || null,
              discord_message_id: (tweet.discord_message_id as string | null) || null,
              discord_posted_at: (tweet.discord_posted_at as string | null) || null,
            };

            // Use the rating from the handler, not from DB (avoids race condition)
            const currentHighlight = Boolean(tweet.highlighted);
            const card = buildTweetCardV2(cctweet, result.newRating, currentHighlight);

            return NextResponse.json({
              type: RESPONSE_UPDATE_MESSAGE,
              data: {
                components: [card],
                flags: 32768,
              },
            });
          }
        }

        // Fallback: ephemeral message
        return NextResponse.json({
          type: RESPONSE_CHANNEL_MESSAGE,
          data: { content: result.ephemeralMessage, flags: 64 },
        });
      }

      // Highlight button — toggle highlight for Uze
      if (action === 'highlight') {
        const result = await handleXFeedHighlight(itemId);

        if (!result.success) {
          return NextResponse.json({
            type: RESPONSE_CHANNEL_MESSAGE,
            data: { content: result.ephemeralMessage, flags: 64 },
          });
        }

        if (result.updateCard) {
          const tweetRows = await drizzleDb.select().from(tweetsTable).where(eq(tweetsTable.id, itemId)).limit(1);
          const tweet = tweetRows[0] as Record<string, unknown> | undefined;

          if (tweet) {
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
              rating: null,
              summary: String(tweet.summary || ''),
              digest_id: (tweet.digest_id as string | null) || null,
              discord_message_id: (tweet.discord_message_id as string | null) || null,
              discord_posted_at: (tweet.discord_posted_at as string | null) || null,
            };

            // Get current rating from tweetRatings table for card rebuild
            const ratingRows = await drizzleDb.select().from(tweetRatingsTable).where(eq(tweetRatingsTable.tweet_id, itemId)).limit(1);
            const currentRating = (ratingRows[0]?.rating ?? null) as TweetRating | null;

            const card = buildTweetCardV2(cctweet, currentRating, result.highlighted);

            return NextResponse.json({
              type: RESPONSE_UPDATE_MESSAGE,
              data: {
                components: [card],
                flags: 32768,
              },
            });
          }
        }

        return NextResponse.json({
          type: RESPONSE_CHANNEL_MESSAGE,
          data: { content: result.ephemeralMessage, flags: 64 },
        });
      }

      // Highlight + Note button — show modal
      if (action === 'highlightnote') {
        const modal = await getXFeedHighlightNoteModal(itemId);
        if (!modal) {
          return NextResponse.json({
            type: RESPONSE_CHANNEL_MESSAGE,
            data: { content: '❌ Tweet not found', flags: 64 },
          });
        }
        return NextResponse.json({
          type: RESPONSE_MODAL,
          data: {
            ...modal,
            custom_id: `xfeed_highlightnotemodal_${itemId}`,
          },
        });
      }

      return NextResponse.json({
        type: RESPONSE_CHANNEL_MESSAGE,
        data: { content: `❌ Unknown xfeed action: ${action}`, flags: 64 },
      });
    }

    // Handle Garden domain (existing)
    if (domain === 'garden') {
      const result = await handleGardenAction(action, itemId);

      if (!result.success) {
        return NextResponse.json({
          type: RESPONSE_CHANNEL_MESSAGE,
          data: { content: result.ephemeralMessage, flags: 64 },
        });
      }

      // If we have an embed update, update the original message
      if (result.embedUpdate) {
        const gardenRows = await drizzleDb.select().from(gardenTable).where(eq(gardenTable.id, itemId)).limit(1);
        const item = gardenRows[0] as Record<string, unknown> | undefined;

        if (item) {
          const gardenItem = {
            id: String(item.id),
            content: String(item.content || ''),
            type: String(item.type || ''),
            interest: String(item.interest || ''),
            temporal: String(item.temporal || ''),
            tags: String(item.tags || '[]'),
            note: String(item.note || ''),
            original_source: item.original_source as string | null,
            media_urls: String(item.media_urls || '[]'),
            metadata: String(item.metadata || '{}'),
            saved_at: String(item.saved_at || ''),
          };

          const updatedEmbed = buildGardenEmbed(gardenItem, result.embedUpdate);
          const buttons = buildGardenButtons(itemId);

          return NextResponse.json({
            type: RESPONSE_UPDATE_MESSAGE,
            data: {
              embeds: [updatedEmbed],
              components: buttons,
            },
          });
        }
      }

      // Fallback: just send ephemeral confirmation
      return NextResponse.json({
        type: RESPONSE_CHANNEL_MESSAGE,
        data: { content: result.ephemeralMessage, flags: 64 },
      });
    }

    return NextResponse.json({
      type: RESPONSE_CHANNEL_MESSAGE,
      data: { content: `❌ Unknown domain: ${domain}`, flags: 64 },
    });
  }

  // Type 5: MODAL_SUBMIT
  if (interactionType === INTERACTION_MODAL_SUBMIT) {
    const modalData = body.data as Record<string, unknown> | undefined;
    const customId = (modalData?.custom_id || body.custom_id) as string;
    const parsed = parseCustomId(customId);

    if (parsed?.domain === 'xfeed' && parsed?.action === 'taskmodal') {
      const tweetId = parsed.itemId;
      const components = (body.data as Record<string, unknown>)?.components as Array<{
        components: Array<{ custom_id: string; value: string }>;
      }> | undefined;

      let title = '';
      let description = '';

      if (components) {
        for (const row of components) {
          for (const comp of row.components) {
            if (comp.custom_id === 'xfeed_task_title') title = comp.value || '';
            if (comp.custom_id === 'xfeed_task_description') description = comp.value || '';
          }
        }
      }

      if (!title.trim()) {
        return NextResponse.json({
          type: RESPONSE_CHANNEL_MESSAGE,
          data: { content: '❌ Task title is required', flags: 64 },
        });
      }

      const result = await handleXFeedTaskModalSubmit(tweetId, title, description);

      return NextResponse.json({
        type: RESPONSE_CHANNEL_MESSAGE,
        data: { content: result.ephemeralMessage, flags: 64 },
      });
    }

    // Highlight + Note modal submit
    if (parsed?.domain === 'xfeed' && parsed?.action === 'highlightnotemodal') {
      const tweetId = parsed.itemId;
      const components = (body.data as Record<string, unknown>)?.components as Array<{
        components: Array<{ custom_id: string; value: string }>;
      }> | undefined;

      let note = '';
      if (components) {
        for (const row of components) {
          for (const comp of row.components) {
            if (comp.custom_id === 'xfeed_highlight_note') note = comp.value || '';
          }
        }
      }

      const result = await handleXFeedHighlightNoteSubmit(tweetId, note);

      return NextResponse.json({
        type: RESPONSE_CHANNEL_MESSAGE,
        data: { content: result.ephemeralMessage, flags: 64 },
      });
    }

    return NextResponse.json({
      type: RESPONSE_CHANNEL_MESSAGE,
      data: { content: '❌ Unknown modal submission', flags: 64 },
    });
  }

  // Unknown interaction type
  logger.warn({ interactionType }, 'Unknown Discord interaction type');
  return NextResponse.json({ error: 'Unknown interaction type' }, { status: 400 });
}
