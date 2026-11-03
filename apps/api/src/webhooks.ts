// Admin management of announcement webhooks (Discord or signed JSON). The worker delivers them.
import { randomBytes } from 'node:crypto';
import { modPayload, mods, outbox, webhooks, type Db, type EventPayload } from '@dsg/db';
import { looksPublic } from '@dsg/net';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { newId, requireAdmin, type User } from './auth.ts';

const DISCORD = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;
const EVENTS = ['mod_published', 'release_published'] as const;

const Input = z
  .object({
    kind: z.enum(['discord', 'json']),
    url: z.url(),
    events: z.array(z.enum(EVENTS)).min(1).default([...EVENTS]),
    filters: z.object({ game: z.string().optional(), type: z.string().optional(), device: z.string().optional() }).strict().default({}),
  })
  .strict()
  .refine((w) => (w.kind === 'discord' ? DISCORD.test(w.url) : looksPublic(w.url)), {
    message: 'Discord: paste the channel webhook URL (https://discord.com/api/webhooks/…); JSON: a public https URL',
    path: ['url'],
  });

type Env = { Variables: { user: User } };

/** Only the last characters are shown again: the full URL is a credential. */
const mask = (url: string) => url.replace(/(\/api\/webhooks\/\d+\/).+(.{4})$/, '$1…$2');

export function webhookRoutes(db: Db, siteUrl: string) {
  const app = new Hono<Env>();
  // Scoped: other /v1/admin routes are for moderators, not only admins
  for (const path of ['/webhooks', '/webhooks/*']) app.use(path, requireAdmin(db));

  app.get('/webhooks', async (c) => {
    const rows = await db.select().from(webhooks).orderBy(desc(webhooks.createdAt));
    const pending = await db.select({ webhookId: outbox.webhookId }).from(outbox).where(isNull(outbox.deliveredAt));
    return c.json({
      items: rows.map((w) => ({
        id: w.id,
        kind: w.kind,
        url: mask(w.url),
        events: w.events,
        filters: w.filters,
        active: w.active,
        last_status: w.lastStatus,
        last_delivery_at: w.lastDeliveryAt?.toISOString() ?? null,
        pending: pending.filter((p) => p.webhookId === w.id).length,
      })),
    });
  });

  app.post('/webhooks', async (c) => {
    const parsed = Input.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    const secret = randomBytes(24).toString('base64url');
    const [w] = await db
      .insert(webhooks)
      .values({ id: newId(), ...parsed.data, secret, createdBy: c.get('user').id })
      .returning();
    // The JSON signing secret is shown once, now
    return c.json({ id: w!.id, kind: w!.kind, events: w!.events, secret: w!.kind === 'json' ? secret : undefined }, 201);
  });

  app.delete('/webhooks/:id', async (c) => {
    const [w] = await db.delete(webhooks).where(eq(webhooks.id, c.req.param('id'))).returning({ id: webhooks.id });
    return w ? c.body(null, 204) : c.json({ error: 'not found' }, 404);
  });

  /** Queues a sample announcement (the newest published mod); the worker sends it within a minute. */
  app.post('/webhooks/:id/test', async (c) => {
    const [w] = await db.select().from(webhooks).where(eq(webhooks.id, c.req.param('id')));
    if (!w) return c.json({ error: 'not found' }, 404);
    const [m] = await db.select({ id: mods.id }).from(mods).where(and(eq(mods.published, true))).orderBy(desc(mods.updatedAt)).limit(1);
    const mod: EventPayload['mod'] = (m && (await modPayload(db, m.id, siteUrl))) || {
      id: 'example',
      name: 'Example mod',
      type: 'dual_screen_layout',
      summary: 'This is a test announcement from DSG.',
      game: null,
      devices: [],
      url: siteUrl,
      cover_url: null,
    };
    await db.insert(outbox).values({ webhookId: w.id, event: 'test', payload: { event: 'test', mod } });
    return c.json({ queued: true }, 202);
  });

  return app;
}
