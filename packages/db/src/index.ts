import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export * from './schema.ts';
export { schema };

export function createDb(url = process.env.DATABASE_URL ?? 'postgres://dsg:dsg@localhost:5432/dsg') {
  const client = postgres(url, { max: Number(process.env.DATABASE_POOL ?? 10), onnotice: () => {} });
  return Object.assign(drizzle(client, { schema }), { $client: client });
}

export type Db = ReturnType<typeof createDb>;
