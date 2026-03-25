import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Lazy initialization — avoids crashing during Next.js build when DATABASE_URL is not set.
let _db: NeonHttpDatabase<typeof schema> | null = null;

function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    // During `next build` with NEXT_PHASE=phase-production-build, DB calls won't happen
    // for SSG pages. Return a no-op proxy so the module loads without crashing.
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      // Return a proxy that throws on use — build-time pages shouldn't call DB
      const noop = new Proxy({} as NeonHttpDatabase<typeof schema>, {
        get: (_t, prop) => {
          if (prop === 'then') return undefined; // not a Promise
          return () => { throw new Error('DB not available during build'); };
        },
      });
      return noop;
    }
    throw new Error('DATABASE_URL environment variable is not set');
  }
  const sqlConnection = neon(url);
  _db = drizzle(sqlConnection, { schema });
  return _db;
}

// Proxy that lazily initializes the DB on first use
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get: (_target, prop) => {
    if (prop === 'then') return undefined; // not a Promise
    const dbInstance = getDb();
    const value = (dbInstance as any)[prop];
    if (typeof value === 'function') {
      return value.bind(dbInstance);
    }
    return value;
  },
});

export type DB = typeof db;
