import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './index.ts';

const db = createDb();
await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
console.log('migrations applied');
await db.$client.end();
