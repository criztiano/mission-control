import { db } from '@/db/client';
import { garden } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';

interface GardenActionResult {
  success: boolean;
  ephemeralMessage: string;
  embedUpdate?: Record<string, unknown>;
}

/**
 * Pin a garden item — moves it to "now" temporal with pinned flag.
 */
export async function handleGardenPin(itemId: string): Promise<GardenActionResult> {
  const rows = await db.select().from(garden).where(eq(garden.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) {
    return { success: false, ephemeralMessage: '❌ Garden item not found.' };
  }

  const now = new Date().toISOString();
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(item.metadata || '{}'); } catch {}

  await db.update(garden).set({
    temporal: 'now',
    metadata: JSON.stringify({ ...metadata, pinned: true, pinned_at: now }),
    saved_at: now,
  }).where(eq(garden.id, itemId));

  logger.info({ itemId }, 'Garden item pinned via Discord');

  return {
    success: true,
    ephemeralMessage: '📌 Pinned to garden',
    embedUpdate: {
      color: 0x22c55e, // green
      footer: { text: '✅ Pinned' },
    },
  };
}

/**
 * Snooze a garden item — moves to "later" temporal, sets snooze_until to 1 day from now.
 */
export async function handleGardenSnooze(itemId: string): Promise<GardenActionResult> {
  const rows = await db.select().from(garden).where(eq(garden.id, itemId)).limit(1);
  if (!rows[0]) {
    return { success: false, ephemeralMessage: '❌ Garden item not found.' };
  }

  const now = new Date();
  const snoozeUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  await db.update(garden).set({
    temporal: 'later',
    snooze_until: snoozeUntil,
    saved_at: now.toISOString(),
  }).where(eq(garden.id, itemId));

  logger.info({ itemId, snoozeUntil }, 'Garden item snoozed via Discord');

  return {
    success: true,
    ephemeralMessage: '⏰ Snoozed for 1 day',
    embedUpdate: {
      color: 0x6b7280, // grey
      footer: { text: '💤 Snoozed — back tomorrow' },
    },
  };
}

/**
 * Dismiss a garden item — sets temporal to "never" (soft dismiss).
 */
export async function handleGardenDismiss(itemId: string): Promise<GardenActionResult> {
  const rows = await db.select().from(garden).where(eq(garden.id, itemId)).limit(1);
  if (!rows[0]) {
    return { success: false, ephemeralMessage: '❌ Garden item not found.' };
  }

  const now = new Date().toISOString();

  await db.update(garden).set({
    temporal: 'never',
    saved_at: now,
  }).where(eq(garden.id, itemId));

  logger.info({ itemId }, 'Garden item dismissed via Discord');

  return {
    success: true,
    ephemeralMessage: '🗑️ Dismissed',
    embedUpdate: {
      color: 0x374151, // dim grey
      footer: { text: '🗑️ Dismissed' },
    },
  };
}
