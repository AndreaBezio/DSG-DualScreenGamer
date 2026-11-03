// Delivers queued announcements: Discord embeds or signed JSON posts, retried with backoff.
import { createHmac } from 'node:crypto';
import { outbox, webhooks, type Db, type EventPayload } from '@dsg/db';
import { guardedFetch, isPublicUrl, type UrlGuard } from '@dsg/net';
import { and, asc, eq, isNull, lt, lte } from 'drizzle-orm';
import type { FetchLike } from './github.ts';

export const MAX_ATTEMPTS = 3;
const DISCORD = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;

export const isDiscordWebhook = (url: string) => DISCORD.test(url);

const TYPE_LABEL: Record<string, string> = {
  dual_screen_layout: 'Dual-screen layout',
  port: 'Native port',
  texture_pack: 'Texture pack',
  patch: 'Patch',
  companion_app: 'Companion app',
  shader: 'Shader',
  utility: 'Utility',
};

export function discordMessage(p: EventPayload) {
  const title =
    p.event === 'release_published'
      ? `${p.mod.name} ${p.release?.version ?? ''}`.trim()
      : p.event === 'test'
        ? `Test from DSG: ${p.mod.name}`
        : `New on DSG: ${p.mod.name}`;
  return {
    username: 'DSG',
    embeds: [
      {
        title,
        url: p.mod.url,
        description: p.mod.summary,
        color: 0x0e9f96,
        ...(p.mod.cover_url ? { image: { url: p.mod.cover_url } } : {}),
        fields: [
          { name: 'Type', value: TYPE_LABEL[p.mod.type] ?? p.mod.type, inline: true },
          ...(p.mod.game ? [{ name: 'Game', value: p.mod.game, inline: true }] : []),
          ...(p.release ? [{ name: 'Version', value: p.release.version, inline: true }] : []),
        ],
        ...(p.release ? { timestamp: p.release.published_at } : {}),
      },
    ],
  };
}

export const signBody = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

/** Sends due deliveries; failures wait 1, 2, 4… minutes, up to MAX_ATTEMPTS tries. */
export async function deliverOutbox(
  db: Db,
  opts: { fetch?: FetchLike; guard?: UrlGuard; now?: Date; limit?: number } = {},
): Promise<{ delivered: number; failed: number }> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetch ?? fetch;
  const guard = opts.guard ?? ((u: string) => isPublicUrl(u));
  const due = await db
    .select({ o: outbox, w: webhooks })
    .from(outbox)
    .innerJoin(webhooks, eq(webhooks.id, outbox.webhookId))
    .where(and(isNull(outbox.deliveredAt), lte(outbox.nextAttemptAt, now), lt(outbox.attempts, MAX_ATTEMPTS), eq(webhooks.active, true)))
    .orderBy(asc(outbox.id))
    .limit(opts.limit ?? 50);

  let delivered = 0;
  let failed = 0;
  for (const { o, w } of due) {
    let status: string;
    try {
      let res: Response;
      if (w.kind === 'discord') {
        if (!isDiscordWebhook(w.url)) throw new Error('not a Discord webhook URL');
        res = await fetchImpl(w.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'User-Agent': 'dsg-worker' },
          body: JSON.stringify(discordMessage(o.payload)),
        });
      } else {
        const body = JSON.stringify(o.payload);
        res = await guardedFetch(
          w.url,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'User-Agent': 'dsg-worker',
              'X-DSG-Event': o.event,
              'X-DSG-Delivery': String(o.id),
              'X-DSG-Signature': signBody(w.secret, body),
            },
            body,
          },
          { fetch: fetchImpl, guard, maxRedirects: 0 },
        );
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      status = `ok ${res.status}`;
      await db.update(outbox).set({ deliveredAt: now, attempts: o.attempts + 1, lastError: null }).where(eq(outbox.id, o.id));
      delivered++;
    } catch (e) {
      status = `error: ${(e as Error).message}`.slice(0, 200);
      const attempts = o.attempts + 1;
      await db
        .update(outbox)
        .set({ attempts, lastError: status, nextAttemptAt: new Date(now.getTime() + 2 ** (attempts - 1) * 60_000) })
        .where(eq(outbox.id, o.id));
      failed++;
    }
    await db.update(webhooks).set({ lastStatus: status, lastDeliveryAt: now }).where(eq(webhooks.id, w.id));
  }
  return { delivered, failed };
}
