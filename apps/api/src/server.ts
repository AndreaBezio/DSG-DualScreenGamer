import { createDb } from '@dsg/db';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';

const db = createDb();
const app = createApp(db, {
  adminToken: process.env.ADMIN_TOKEN,
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120),
  trustProxy: process.env.TRUST_PROXY === 'true',
  publicUrl: process.env.PUBLIC_API_URL,
});

const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: app.fetch, port }, () => console.log(`dsg api listening on :${port}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close();
    void db.$client.end({ timeout: 5 }).then(() => process.exit(0));
  });
}
