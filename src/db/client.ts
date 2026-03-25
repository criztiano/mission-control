import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const sqlConnection = neon(process.env.DATABASE_URL!);
export const db = drizzle(sqlConnection, { schema });
export type DB = typeof db;
