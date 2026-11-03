// One-off sync: registry -> database, then GitHub releases and IGDB metadata.
import { createDb } from '@dsg/db';
import { loadRegistry } from './registry.ts';
import { prepareRegistry } from './source.ts';
import { runSync } from './sync.ts';

const { registry, errors } = loadRegistry(prepareRegistry());
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
const db = createDb();
const result = await runSync(db, registry, { hashMaxBytes: Number(process.env.SYNC_HASH_MAX_BYTES ?? 0), raApiKey: process.env.RA_API_KEY || undefined, uploadDir: process.env.UPLOAD_DIR });
await db.$client.end();
process.exit(result.status === 'ok' ? 0 : 2);
