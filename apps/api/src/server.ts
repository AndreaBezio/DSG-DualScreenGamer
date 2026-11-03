import { createDb } from '@dsg/db';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { signerFromPem } from './signing.ts';

const db = createDb();
const app = createApp(db, {
  adminToken: process.env.ADMIN_TOKEN,
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120),
  trustProxy: process.env.TRUST_PROXY === 'true',
  publicUrl: process.env.PUBLIC_API_URL,
  siteUrl: process.env.PUBLIC_SITE_URL,
  installSalt: process.env.INSTALL_SALT || undefined,
  signer: process.env.INDEX_SIGNING_KEY ? signerFromPem(process.env.INDEX_SIGNING_KEY) : undefined,
  account: {
    internalToken: process.env.INTERNAL_TOKEN,
    uploadDir: process.env.UPLOAD_DIR ?? '/data/uploads',
    uploadMaxBytes: Number(process.env.UPLOAD_MAX_MB ?? 10) * 1048576,
    oauth: {
      ...(process.env.GITHUB_OAUTH_CLIENT_ID
        ? { github: { clientId: process.env.GITHUB_OAUTH_CLIENT_ID, clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? '' } }
        : {}),
      ...(process.env.DISCORD_CLIENT_ID
        ? { discord: { clientId: process.env.DISCORD_CLIENT_ID, clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '' } }
        : {}),
    },
    admins: {
      github: (process.env.ADMIN_GITHUB_LOGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      discord: (process.env.ADMIN_DISCORD_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    },
  },
});

const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: app.fetch, port }, () => console.log(`dsg api listening on :${port}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close();
    void db.$client.end({ timeout: 5 }).then(() => process.exit(0));
  });
}
