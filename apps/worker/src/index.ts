// Long-running worker: syncs on start, every SYNC_INTERVAL_MINUTES, and whenever the API flags a request.
import { createDb } from '@dsg/db';
import { deliverOutbox } from './outbox.ts';
import { loadRegistry } from './registry.ts';
import { prepareRegistry } from './source.ts';
import { getState, runSync, setState } from './sync.ts';

const db = createDb();
const intervalMs = Number(process.env.SYNC_INTERVAL_MINUTES ?? 30) * 60_000;
const hashMaxBytes = Number(process.env.SYNC_HASH_MAX_BYTES ?? 0);
let lastRun = 0;
let running = false;

async function tick() {
  // Announcements go out every minute, independently of the sync schedule
  await deliverOutbox(db).catch((e) => console.error('outbox', e));
  if (running) return;
  const requested = await getState<number>(db, 'sync_requested_at');
  if (Date.now() - lastRun < intervalMs && !(requested && requested > lastRun)) return;
  running = true;
  lastRun = Date.now();
  try {
    const { registry, errors } = loadRegistry(prepareRegistry());
    if (errors.length) {
      // Keep serving the last good data; a broken manifest must never wipe the catalog
      console.error(`registry invalid, sync skipped:\n${errors.join('\n')}`);
    } else {
      await runSync(db, registry, { hashMaxBytes, raApiKey: process.env.RA_API_KEY || undefined, uploadDir: process.env.UPLOAD_DIR, siteUrl: process.env.PUBLIC_SITE_URL });
    }
  } catch (e) {
    console.error('sync failed', e);
  } finally {
    await setState(db, 'last_sync_at', Date.now());
    running = false;
  }
}

console.log(`dsg worker: sync every ${intervalMs / 60_000} min`);
await tick();
setInterval(() => void tick(), 60_000);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await db.$client.end({ timeout: 5 });
    process.exit(0);
  });
}
