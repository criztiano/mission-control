import { getCCDatabase, getCCDatabaseWrite } from './cc-db';
import { logger } from './logger';

// --- Types ---

export interface OGData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  fetched_at: string;
}

// --- Schema Migration ---

/**
 * Create og_cache table if it doesn't exist.
 * Safe to call multiple times — idempotent.
 */
export function ensureOGCacheTable(): void {
  const db = getCCDatabaseWrite();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS og_cache (
        url TEXT PRIMARY KEY,
        title TEXT,
        description TEXT,
        image TEXT,
        fetched_at TEXT NOT NULL
      )
    `);
    logger.info('og_cache table ready');
  } finally {
    db.close();
  }
}

// --- Cache Operations ---

/**
 * Get OG data from cache if it exists and is fresh (< 7 days old).
 * Returns null if not found or stale.
 */
export function getOGCache(url: string): OGData | null {
  ensureOGCacheTable();

  const db = getCCDatabase(true);
  const row = db.prepare('SELECT * FROM og_cache WHERE url = ?').get(url) as OGData | undefined;

  if (!row) return null;

  // Check if cache is fresh (< 7 days)
  const fetchedAt = new Date(row.fetched_at).getTime();
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  if (now - fetchedAt > sevenDays) {
    return null; // Stale cache
  }

  return row;
}

/**
 * Save OG data to cache.
 */
export function setOGCache(url: string, data: Omit<OGData, 'url' | 'fetched_at'>): void {
  ensureOGCacheTable();

  const db = getCCDatabaseWrite();
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO og_cache (url, title, description, image, fetched_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      url,
      data.title,
      data.description,
      data.image,
      new Date().toISOString()
    );

    logger.info(`OG cache: saved data for ${url}`);
  } finally {
    db.close();
  }
}
