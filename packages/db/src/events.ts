// Queues announcements for the webhooks that want them. Delivery is the worker's job (apps/worker/src/outbox.ts).
import { and, asc, eq } from 'drizzle-orm';
import type { DbOrTx } from './index.ts';
import { games, modMedia, mods, outbox, webhooks, type EventPayload } from './schema.ts';

export async function modPayload(db: DbOrTx, modId: string, siteUrl: string): Promise<EventPayload['mod'] | null> {
  const [m] = await db.select().from(mods).where(eq(mods.id, modId));
  if (!m) return null;
  const [cover] = await db
    .select({ url: modMedia.url })
    .from(modMedia)
    .where(and(eq(modMedia.modId, m.id)))
    .orderBy(asc(modMedia.position))
    .limit(1);
  const [game] = m.gameId ? await db.select({ title: games.title, cover: games.coverUrl }).from(games).where(eq(games.id, m.gameId)) : [];
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    summary: m.summary,
    game: game?.title ?? null,
    devices: m.devices,
    url: `${siteUrl.replace(/\/$/, '')}/mods/${m.id}`,
    cover_url: cover?.url ?? game?.cover ?? null,
  };
}

/** Adds one outbox row per active webhook subscribed to the event whose filters match the mod. */
export async function enqueueEvent(
  db: DbOrTx,
  event: EventPayload['event'],
  modId: string,
  siteUrl: string,
  release?: EventPayload['release'],
): Promise<number> {
  const mod = await modPayload(db, modId, siteUrl);
  if (!mod) return 0;
  const [m] = await db.select({ gameId: mods.gameId, published: mods.published }).from(mods).where(eq(mods.id, modId));
  if (!m?.published) return 0;
  const hooks = await db.select().from(webhooks).where(eq(webhooks.active, true));
  const wanted = hooks.filter(
    (h) =>
      h.events.includes(event) &&
      (!h.filters.game || h.filters.game === m.gameId) &&
      (!h.filters.type || h.filters.type === mod.type) &&
      (!h.filters.device || mod.devices.length === 0 || mod.devices.includes(h.filters.device)),
  );
  if (!wanted.length) return 0;
  const payload: EventPayload = { event, mod, ...(release ? { release } : {}) };
  await db.insert(outbox).values(wanted.map((h) => ({ webhookId: h.id, event, payload })));
  return wanted.length;
}
