import { getCCDatabase } from '@/lib/cc-db';
import { logger } from '@/lib/logger';

interface GardenActionResult {
  success: boolean;
  ephemeralMessage: string;
  embedUpdate?: Record<string, unknown>;
}

/**
 * Pin a garden item — moves it to "now" temporal with pinned flag.
 */
export function handleGardenPin(itemId: string): GardenActionResult {
  const db = getCCDatabase();

  const item = db.prepare('SELECT * FROM garden WHERE id = ?').get(itemId) as Record<string, unknown> | undefined;
  if (!item) {
    return { success: false, ephemeralMessage: '❌ Garden item not found.' };
  }

  const writeDb = getCCDatabase();
  const now = new Date().toISOString();
  writeDb.prepare(`
    UPDATE garden SET temporal = 'now', metadata = ?, saved_at = ? WHERE id = ?
  `).run(
    JSON.stringify({ ...(JSON.parse(String(item.metadata || '{}'))), pinned: true, pinned_at: now }),
    now,
    itemId
  );

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
export function handleGardenSnooze(itemId: string): GardenActionResult {
  const db = getCCDatabase();

  const item = db.prepare('SELECT * FROM garden WHERE id = ?').get(itemId) as Record<string, unknown> | undefined;
  if (!item) {
    return { success: false, ephemeralMessage: '❌ Garden item not found.' };
  }

  const writeDb = getCCDatabase();
  const now = new Date();
  const snoozeUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  writeDb.prepare(`
    UPDATE garden SET temporal = 'later', snooze_until = ?, saved_at = ? WHERE id = ?
  `).run(snoozeUntil, now.toISOString(), itemId);

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
export function handleGardenDismiss(itemId: string): GardenActionResult {
  const db = getCCDatabase();

  const item = db.prepare('SELECT * FROM garden WHERE id = ?').get(itemId) as Record<string, unknown> | undefined;
  if (!item) {
    return { success: false, ephemeralMessage: '❌ Garden item not found.' };
  }

  const writeDb = getCCDatabase();
  const now = new Date().toISOString();
  writeDb.prepare(`
    UPDATE garden SET temporal = 'never', saved_at = ? WHERE id = ?
  `).run(now, itemId);

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
