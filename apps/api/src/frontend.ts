// Endpoints for frontends and launchers that handle whole libraries: batch lookup,
// a compact "which games have mods" index, update checks and feeds.
import { createHash } from 'node:crypto';
import { gameIdentifiers, games, modReleases, mods, type Db } from '@dsg/db';
import { compareVersions, IDENTIFIER_KINDS, type IdentifierKind } from '@dsg/schema';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { ModDto } from './dto.ts';
import * as q from './queries.ts';

/** Identifier query params (plus `ra` for retroachievements, `igdb`, `filename`) -> lookup keys. */
export function keysFrom(src: Record<string, unknown>): q.LookupKeys {
  const str = (k: string) => (typeof src[k] === 'string' || typeof src[k] === 'number' ? String(src[k]).trim() : '');
  const identifiers: { kind: IdentifierKind; value: string }[] = [];
  for (const k of IDENTIFIER_KINDS) if (str(k)) identifiers.push({ kind: k, value: str(k) });
  if (str('ra') && !str('retroachievements')) identifiers.push({ kind: 'retroachievements', value: str('ra') });
  const igdb = Number(str('igdb'));
  return {
    identifiers,
    igdb: Number.isInteger(igdb) && igdb > 0 ? igdb : undefined,
    filename: str('filename') || undefined,
  };
}

export const hasKeys = (k: q.LookupKeys) => k.identifiers.length > 0 || !!k.igdb || !!k.filename;

export type ClientFilter = { platform?: string; device?: string; emulator?: string; emulator_version?: string; type?: string };

/** Resolves the platform alias; returns an error message for unknown platforms. */
export async function resolveFilter(db: Db, f: ClientFilter): Promise<{ filter: q.ModFilter } | { error: string }> {
  let platform: string | undefined;
  if (f.platform) {
    const p = await q.resolvePlatform(db, f.platform);
    if (!p) return { error: `unknown platform "${f.platform}" (see /v1/platforms)` };
    platform = p;
  }
  return {
    filter: { platform, device: f.device, emulator: f.emulator, emulatorVersion: f.emulator_version, type: f.type },
  };
}

export const BATCH_MAX = 500;

export async function batchLookup(db: Db, items: (Record<string, unknown> & { ref?: unknown })[], f: q.ModFilter) {
  const results: { ref: unknown; game_id: string | null; matched: { kind: string; value: string } | null; mod_ids: string[] }[] = [];
  const hits = new Map<number, Awaited<ReturnType<typeof q.findGame>>>();
  // One query per item is fine for 500 items; most libraries are matched by the compact index anyway
  for (const [i, item] of items.entries()) hits.set(i, hasKeys(keysFrom(item)) ? await q.findGame(db, keysFrom(item), f.platform) : null);
  const gameIds = [...new Set([...hits.values()].filter(Boolean).map((h) => h!.gameId))];
  const all = await q.modsForGames(db, gameIds);
  const mods: Record<string, ModDto> = {};
  for (const [i, item] of items.entries()) {
    const hit = hits.get(i);
    if (!hit) {
      results.push({ ref: item.ref ?? i, game_id: null, matched: null, mod_ids: [] });
      continue;
    }
    const matching = q.filterMods(
      all.filter((m) => m.game_id === hit.gameId),
      { ...f, identifiers: hit.same.length ? hit.same : undefined },
    );
    for (const m of matching) mods[m.id] = m;
    results.push({ ref: item.ref ?? i, game_id: hit.gameId, matched: hit.matched, mod_ids: matching.map((m) => m.id) });
  }
  return { results, mods };
}

/**
 * Every key that identifies a game with at least one published mod. Small enough to cache
 * on the device and check a 100k-ROM library offline; refresh with If-None-Match.
 */
export async function compactIndex(db: Db) {
  const withMods = await db
    .select({ gameId: mods.gameId, modId: mods.id })
    .from(mods)
    .where(and(eq(mods.published, true), isNotNull(mods.gameId)));
  const games_: Record<string, string[]> = {};
  for (const r of withMods) (games_[r.gameId!] ??= []).push(r.modId);
  const ids = Object.keys(games_);
  const keys: Record<string, string> = {};
  if (ids.length) {
    const idents = await db.select().from(gameIdentifiers).where(inArray(gameIdentifiers.gameId, ids));
    for (const i of idents) keys[`${i.kind}:${i.value}`] = i.gameId;
    const igdb = await db.select({ id: games.id, igdb: games.igdbId }).from(games).where(and(inArray(games.id, ids), isNotNull(games.igdbId)));
    for (const g of igdb) keys[`igdb:${g.igdb}`] = g.id;
  }
  return { keys, games: games_ };
}

export async function updatesFor(db: Db, installed: { mod_id: string; version: string }[], f: q.ModFilter) {
  const out: { mod_id: string; installed: string; latest: ModDto['latest_release']; install: ModDto['install'] }[] = [];
  for (const i of installed.slice(0, BATCH_MAX)) {
    const mod = await q.getMod(db, i.mod_id);
    const latest = mod?.latest_release;
    if (!mod || !latest || compareVersions(latest.version, i.version) <= 0) continue;
    // Still compatible with what the client runs?
    if ((f.platform || f.emulator || f.device) && !q.filterMods([{ ...mod, _targets: mod.targets.map(toTargetRow) }], f).length) continue;
    out.push({ mod_id: mod.id, installed: i.version, latest, install: mod.install });
  }
  return out;
}

const toTargetRow = (t: ModDto['targets'][number]) => ({
  platform: t.platform,
  emulator: t.emulator,
  minVersion: t.min_version,
  maxVersion: t.max_version,
  identifiers: t.identifiers,
});

/** `a@1.0,b@2.1` */
export function parseInstalled(s: string): { mod_id: string; version: string }[] {
  return s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const at = p.lastIndexOf('@');
      return at > 0 ? { mod_id: p.slice(0, at), version: p.slice(at + 1) } : { mod_id: p, version: '0' };
    });
}

export type FeedItem = { id: string; title: string; url: string; summary: string; date: Date; mod_id: string; kind: 'mod' | 'release' };

/** New mods and new releases, newest first. */
export async function feedItems(db: Db, siteUrl: string, f: { game?: string; type?: string; device?: string }, limit = 50): Promise<FeedItem[]> {
  const where = [eq(mods.published, true)];
  if (f.game) where.push(eq(mods.gameId, f.game));
  if (f.type) where.push(eq(mods.type, f.type));
  const [releases, added] = await Promise.all([
    db
      .select({ r: modReleases, m: mods })
      .from(modReleases)
      .innerJoin(mods, eq(mods.id, modReleases.modId))
      .where(and(...where))
      .orderBy(desc(modReleases.publishedAt))
      .limit(limit),
    db.select().from(mods).where(and(...where)).orderBy(desc(mods.createdAt)).limit(limit),
  ]);
  const site = siteUrl.replace(/\/$/, '');
  const device = (m: typeof mods.$inferSelect) => !f.device || m.devices.length === 0 || m.devices.includes(f.device);
  const items: FeedItem[] = [
    ...releases
      .filter(({ m }) => device(m))
      .map(({ r, m }) => ({
        id: `${site}/mods/${m.id}#release-${r.tag}`,
        title: `${m.name} ${r.version}`,
        url: `${site}/mods/${m.id}`,
        summary: r.changelog?.slice(0, 600) || m.summary,
        date: r.publishedAt,
        mod_id: m.id,
        kind: 'release' as const,
      })),
    ...added.filter(device).map((m) => ({
      id: `${site}/mods/${m.id}`,
      title: `New: ${m.name}`,
      url: `${site}/mods/${m.id}`,
      summary: m.summary,
      date: m.createdAt,
      mod_id: m.id,
      kind: 'mod' as const,
    })),
  ];
  return items.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);
}

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export function atom(items: FeedItem[], selfUrl: string, siteUrl: string): string {
  const updated = (items[0]?.date ?? new Date(0)).toISOString();
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>DSG — Dual Screen Gamer</title>
  <subtitle>New dual-screen mods and releases</subtitle>
  <id>${esc(selfUrl)}</id>
  <link rel="self" href="${esc(selfUrl)}"/>
  <link rel="alternate" href="${esc(siteUrl)}"/>
  <updated>${updated}</updated>
${items
  .map(
    (i) => `  <entry>
    <id>${esc(i.id)}</id>
    <title>${esc(i.title)}</title>
    <link rel="alternate" href="${esc(i.url)}"/>
    <updated>${i.date.toISOString()}</updated>
    <summary>${esc(i.summary)}</summary>
    <category term="${i.kind}"/>
  </entry>`,
  )
  .join('\n')}
</feed>
`;
}

export function jsonFeed(items: FeedItem[], selfUrl: string, siteUrl: string) {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'DSG — Dual Screen Gamer',
    home_page_url: siteUrl,
    feed_url: selfUrl,
    items: items.map((i) => ({
      id: i.id,
      url: i.url,
      title: i.title,
      summary: i.summary,
      date_published: i.date.toISOString(),
      tags: [i.kind],
      _dsg: { mod_id: i.mod_id },
    })),
  };
}

export function etag(body: string): string {
  return `"${createHash('sha1').update(body).digest('base64url')}"`;
}
