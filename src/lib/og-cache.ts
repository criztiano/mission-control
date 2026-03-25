import { logger } from './logger';
import { db } from '@/db/client';
import { ogCache } from '@/db/schema';
import { eq } from 'drizzle-orm';

// --- Types ---

export interface OGData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  fetched_at: string;
}

/**
 * @deprecated No-op — table created by drizzle-kit schema migration.
 */
export async function ensureOGCacheTable(): Promise<void> {
  logger.info('og_cache table managed by drizzle-kit schema');
}

/**
 * Get OG data from cache if it exists and is fresh (< 7 days old).
 * Returns null if not found or stale.
 */
export async function getOGCache(url: string): Promise<OGData | null> {
  const rows = await db.select().from(ogCache).where(eq(ogCache.url, url)).limit(1);
  const row = rows[0];

  if (!row) return null;

  // Check if cache is fresh (< 7 days)
  const fetchedAt = new Date(row.fetched_at).getTime();
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  if (now - fetchedAt > sevenDays) {
    return null; // Stale cache
  }

  return {
    url: row.url,
    title: row.title ?? null,
    description: row.description ?? null,
    image: row.image ?? null,
    fetched_at: row.fetched_at,
  };
}

/**
 * Save OG data to cache.
 */
export async function setOGCache(url: string, data: Omit<OGData, 'url' | 'fetched_at'>): Promise<void> {
  const fetched_at = new Date().toISOString();
  await db
    .insert(ogCache)
    .values({ url, title: data.title, description: data.description, image: data.image, fetched_at })
    .onConflictDoUpdate({
      target: ogCache.url,
      set: { title: data.title, description: data.description, image: data.image, fetched_at },
    });

  logger.info(`OG cache: saved data for ${url}`);
}
