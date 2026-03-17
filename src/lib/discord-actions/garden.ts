import { getCCDatabase } from '@/lib/cc-db';
import { logger } from '@/lib/logger';

interface GardenActionResult {
  success: boolean;
  ephemeralMessage: string;
  embedUpdate?: Record<string, unknown>;
}

/**
 * Set a garden item's interest classification.
 */
export function handleGardenInterest(itemId: string, interest: string): GardenActionResult {
  const validInterests = ['instrument', 'ingredient', 'idea', 'knowledge'];
  if (!validInterests.includes(interest)) {
    return { success: false, ephemeralMessage: `❌ Unknown interest: ${interest}` };
  }

  const db = getCCDatabase();
  const item = db.prepare('SELECT * FROM garden WHERE id = ?').get(itemId) as Record<string, unknown> | undefined;
  if (!item) {
    return { success: false, ephemeralMessage: '❌ Garden item not found.' };
  }

  db.prepare('UPDATE garden SET interest = ?, saved_at = ? WHERE id = ?')
    .run(interest, new Date().toISOString(), itemId);

  const labels: Record<string, string> = {
    instrument: '🔧 Instrument',
    ingredient: '🧩 Ingredient',
    idea: '💡 Idea',
    knowledge: '📚 Knowledge',
  };

  logger.info({ itemId, interest }, 'Garden item interest set via Discord');

  return {
    success: true,
    ephemeralMessage: `${labels[interest]} — interest set`,
    embedUpdate: { interest },
  };
}

/**
 * Set a garden item's temporal classification.
 */
export function handleGardenTemporal(itemId: string, temporal: string): GardenActionResult {
  const validTemporal = ['now', 'later', 'ever'];
  if (!validTemporal.includes(temporal)) {
    return { success: false, ephemeralMessage: `❌ Unknown temporal: ${temporal}` };
  }

  const db = getCCDatabase();
  const item = db.prepare('SELECT * FROM garden WHERE id = ?').get(itemId) as Record<string, unknown> | undefined;
  if (!item) {
    return { success: false, ephemeralMessage: '❌ Garden item not found.' };
  }

  const updates: Record<string, unknown> = {
    temporal,
    saved_at: new Date().toISOString(),
  };

  // If snoozing, set snooze_until to 1 day from now
  if (temporal === 'later') {
    updates.snooze_until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  } else {
    updates.snooze_until = null;
  }

  db.prepare('UPDATE garden SET temporal = ?, snooze_until = ?, saved_at = ? WHERE id = ?')
    .run(updates.temporal, updates.snooze_until, updates.saved_at, itemId);

  const labels: Record<string, string> = {
    now: '⚡ Now',
    later: '⏰ Later (1 day)',
    ever: '♾️ Ever',
  };

  logger.info({ itemId, temporal }, 'Garden item temporal set via Discord');

  return {
    success: true,
    ephemeralMessage: `${labels[temporal]} — temporal set`,
    embedUpdate: { temporal },
  };
}

/**
 * Dismiss a garden item — sets temporal to "never" (soft delete).
 */
export function handleGardenDismiss(itemId: string): GardenActionResult {
  const db = getCCDatabase();
  const item = db.prepare('SELECT * FROM garden WHERE id = ?').get(itemId) as Record<string, unknown> | undefined;
  if (!item) {
    return { success: false, ephemeralMessage: '❌ Garden item not found.' };
  }

  db.prepare('UPDATE garden SET temporal = ?, saved_at = ? WHERE id = ?')
    .run('never', new Date().toISOString(), itemId);

  logger.info({ itemId }, 'Garden item dismissed via Discord');

  return {
    success: true,
    ephemeralMessage: '🗑️ Dismissed',
    embedUpdate: { temporal: 'never' },
  };
}
