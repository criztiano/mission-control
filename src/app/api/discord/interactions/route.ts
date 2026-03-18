import { NextRequest, NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import { logger } from '@/lib/logger';
import { handleGardenInterest, handleGardenTemporal, handleGardenDismiss } from '@/lib/discord-actions/garden';
import { getCCDatabase } from '@/lib/cc-db';
import { buildGardenCardV2, type GardenItem } from '@/lib/discord-cards';

// Discord interaction types
const INTERACTION_PING = 1;
const INTERACTION_MESSAGE_COMPONENT = 3;

// Discord response types
const RESPONSE_PONG = 1;
const RESPONSE_CHANNEL_MESSAGE = 4;
const RESPONSE_UPDATE_MESSAGE = 7;

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
 * Format: {domain}_{action}_{itemId}  (itemId can contain underscores)
 */
function parseCustomId(customId: string): { domain: string; action: string; itemId: string } | null {
  const parts = customId.split('_');
  if (parts.length < 3) return null;

  const domain = parts[0];
  const action = parts[1];
  const itemId = parts.slice(2).join('_');

  return { domain, action, itemId };
}

/**
 * Route garden interactions to the correct handler.
 */
function handleGardenAction(
  action: string,
  itemId: string
): { ephemeralMessage: string; embedUpdate?: Record<string, unknown>; success: boolean } {
  // Interest actions
  if (['instrument', 'ingredient', 'idea', 'knowledge'].includes(action)) {
    return handleGardenInterest(itemId, action);
  }

  // Temporal actions
  if (['now', 'later', 'ever'].includes(action)) {
    return handleGardenTemporal(itemId, action);
  }

  // Dismiss
  if (action === 'dismiss') {
    return handleGardenDismiss(itemId);
  }

  return { success: false, ephemeralMessage: `❌ Unknown garden action: ${action}` };
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

  // Verify signature
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
    logger.info('Discord PING verification successful');
    return NextResponse.json({ type: RESPONSE_PONG });
  }

  // Type 3: MESSAGE_COMPONENT — button click
  if (interactionType === INTERACTION_MESSAGE_COMPONENT) {
    const data = body.data as Record<string, unknown>;
    const customId = data?.custom_id as string;

    if (!customId) {
      return NextResponse.json({
        type: RESPONSE_CHANNEL_MESSAGE,
        data: { content: '❌ Missing custom_id', flags: 64 },
      });
    }

    const parsed = parseCustomId(customId);
    if (!parsed) {
      return NextResponse.json({
        type: RESPONSE_CHANNEL_MESSAGE,
        data: { content: '❌ Invalid interaction format', flags: 64 },
      });
    }

    const { domain, action, itemId } = parsed;

    if (domain === 'garden') {
      const result = handleGardenAction(action, itemId);

      if (!result.success) {
        return NextResponse.json({
          type: RESPONSE_CHANNEL_MESSAGE,
          data: { content: result.ephemeralMessage, flags: 64 },
        });
      }

      // Rebuild the card with updated state
      const ccDb = getCCDatabase();
      const item = ccDb.prepare('SELECT * FROM garden WHERE id = ?').get(itemId) as Record<string, unknown> | undefined;

      if (item) {
        const gardenItem: GardenItem = {
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

        const v2Components = buildGardenCardV2(gardenItem);

        return NextResponse.json({
          type: RESPONSE_UPDATE_MESSAGE,
          data: {
            flags: 32768,
            components: v2Components,
          },
        });
      }

      // Fallback: ephemeral only
      return NextResponse.json({
        type: RESPONSE_CHANNEL_MESSAGE,
        data: { content: result.ephemeralMessage, flags: 64 },
      });
    }

    // Unknown domain
    return NextResponse.json({
      type: RESPONSE_CHANNEL_MESSAGE,
      data: { content: `❌ Unknown domain: ${domain}`, flags: 64 },
    });
  }

  // Unknown interaction type
  logger.warn({ interactionType }, 'Unknown Discord interaction type');
  return NextResponse.json({ error: 'Unknown interaction type' }, { status: 400 });
}
