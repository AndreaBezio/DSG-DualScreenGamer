import {
  devices,
  emulators,
  gameIdentifiers,
  games,
  modMedia,
  modReleases,
  mods,
  modTargets,
  platforms,
  releaseAssets,
  syncRuns,
  type Db,
} from '@dsg/db';
import { normalizeIdentifier, type IdentifierKind } from '@dsg/schema';
import { and, arrayContains, asc, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import type { GameDto, MediaDto, ModDto, ReleaseDto } from './dto.ts';
import { deviceMatches, targetMatches, type MatchQuery } from './match.ts';

type ModRow = typeof mods.$inferSelect;
type GameRow = typeof games.$inferSelect;

export type ModFilter = MatchQuery & { gameId?: string; type?: string; device?: string; q?: string };

async function releasesFor(db: Db, releaseRows: (typeof modReleases.$inferSelect)[]): Promise<Map<number, ReleaseDto>> {
  const out = new Map<number, ReleaseDto>();
  if (!releaseRows.length) return out;
  const assets = await db
    .select()
    .from(releaseAssets)
    .where(inArray(releaseAssets.releaseId, releaseRows.map((r) => r.id)))
    .orderBy(asc(releaseAssets.id));
  for (const r of releaseRows) {
    out.set(r.id, {
      tag: r.tag,
      version: r.version,
      name: r.name,
      prerelease: r.prerelease,
      published_at: r.publishedAt.toISOString(),
      html_url: r.htmlUrl,
      changelog: r.changelog,
      assets: assets
        .filter((a) => a.releaseId === r.id)
        .map((a) => ({ role: a.role, name: a.name, url: a.url, size: a.size, sha256: a.sha256, content_type: a.contentType })),
    });
  }
  return out;
}

function shapeMedia(rows: (typeof modMedia.$inferSelect)[]) {
  const dto = (r: (typeof modMedia.$inferSelect)): MediaDto => ({
    url: r.url,
    width: r.width,
    height: r.height,
    source: r.source as MediaDto['source'],
    caption: r.caption,
  });
  const gallery = rows.filter((r) => r.kind === 'gallery').map(dto);
  const previews: ModDto['previews'] = [];
  for (const top of rows.filter((r) => r.kind === 'top')) {
    const bottom = rows.find((r) => r.kind === 'bottom' && r.pair === top.pair);
    if (bottom) previews.push({ top: dto(top), bottom: dto(bottom), caption: top.caption });
  }
  return { gallery, previews };
}

/** Builds full mod DTOs (targets + latest release) for a set of rows, in a constant number of queries. */
async function hydrateMods(db: Db, rows: ModRow[]): Promise<(ModDto & { _targets: (typeof modTargets.$inferSelect)[] })[]> {
  if (!rows.length) return [];
  const ids = rows.map((m) => m.id);
  const gameIds = [...new Set(rows.map((m) => m.gameId).filter((g): g is string => !!g))];
  const [targets, latest, media, covers] = await Promise.all([
    db.select().from(modTargets).where(inArray(modTargets.modId, ids)).orderBy(asc(modTargets.id)),
    db
      .selectDistinctOn([modReleases.modId])
      .from(modReleases)
      .where(inArray(modReleases.modId, ids))
      .orderBy(modReleases.modId, desc(modReleases.publishedAt)),
    db.select().from(modMedia).where(inArray(modMedia.modId, ids)).orderBy(asc(modMedia.position)),
    gameIds.length
      ? db.select({ id: games.id, coverUrl: games.coverUrl }).from(games).where(inArray(games.id, gameIds))
      : Promise.resolve([]),
  ]);
  const releases = await releasesFor(db, latest);
  return rows.map((m) => {
    const t = targets.filter((x) => x.modId === m.id);
    const rel = latest.find((r) => r.modId === m.id);
    const { gallery, previews } = shapeMedia(media.filter((x) => x.modId === m.id));
    const cover =
      gallery.find((g) => g.source === 'manifest')?.url ??
      previews[0]?.top.url ??
      gallery[0]?.url ??
      covers.find((c) => c.id === m.gameId)?.coverUrl ??
      null;
    return {
      id: m.id,
      name: m.name,
      type: m.type as ModDto['type'],
      summary: m.summary,
      description: m.description,
      game_id: m.gameId,
      authors: m.authors,
      license: m.license,
      homepage: m.homepage,
      source_repo: m.source.github,
      tags: m.tags,
      cover_url: cover,
      media: gallery,
      previews,
      requires: m.requires,
      devices: m.devices,
      stars: m.stars,
      targets: t.map((x) => ({
        platform: x.platform,
        emulator: x.emulator,
        min_version: x.minVersion,
        max_version: x.maxVersion,
        identifiers: x.identifiers,
      })),
      install: m.install as ModDto['install'],
      latest_release: rel ? releases.get(rel.id)! : null,
      updated_at: m.updatedAt.toISOString(),
      _targets: t,
    };
  });
}

const strip = ({ _targets, ...m }: ModDto & { _targets: unknown }): ModDto => m;

export async function listMods(db: Db, f: ModFilter): Promise<ModDto[]> {
  const where: SQL[] = [];
  if (f.gameId) where.push(eq(mods.gameId, f.gameId));
  if (f.type) where.push(eq(mods.type, f.type));
  if (f.q) where.push(ilike(mods.name, `%${f.q.replace(/[%_]/g, '\\$&')}%`));
  const rows = await db
    .select()
    .from(mods)
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`${mods.lastReleaseAt} desc nulls last`, asc(mods.name));
  const hydrated = await hydrateMods(db, rows);
  return hydrated
    .filter((m) => deviceMatches(m.devices, f.device))
    .filter((m) => !(f.platform || f.emulator || f.identifier) || m._targets.some((t) => targetMatches(t, f)))
    .map(strip);
}

export async function getMod(db: Db, id: string): Promise<ModDto | null> {
  const rows = await db.select().from(mods).where(eq(mods.id, id));
  const [m] = await hydrateMods(db, rows);
  return m ? strip(m) : null;
}

export async function getReleases(db: Db, modId: string): Promise<ReleaseDto[]> {
  const rows = await db.select().from(modReleases).where(eq(modReleases.modId, modId)).orderBy(desc(modReleases.publishedAt));
  const map = await releasesFor(db, rows);
  return rows.map((r) => map.get(r.id)!);
}

async function hydrateGames(db: Db, rows: GameRow[]): Promise<GameDto[]> {
  if (!rows.length) return [];
  const ids = rows.map((g) => g.id);
  const [idents, counts] = await Promise.all([
    db.select().from(gameIdentifiers).where(inArray(gameIdentifiers.gameId, ids)).orderBy(asc(gameIdentifiers.id)),
    db
      .select({ gameId: mods.gameId, n: sql<number>`count(*)::int` })
      .from(mods)
      .where(inArray(mods.gameId, ids))
      .groupBy(mods.gameId),
  ]);
  return rows.map((g) => ({
    id: g.id,
    title: g.title,
    platforms: g.platforms,
    igdb_id: g.igdbId,
    summary: g.summary,
    cover_url: g.coverUrl,
    release_year: g.releaseYear,
    identifiers: idents
      .filter((i) => i.gameId === g.id)
      .map((i) => ({ kind: i.kind as IdentifierKind, value: i.value, platform: i.platform, region: i.region, label: i.label })),
    mod_count: counts.find((c) => c.gameId === g.id)?.n ?? 0,
  }));
}

export async function listGames(db: Db, f: { q?: string; platform?: string; limit: number; offset: number }) {
  const where: SQL[] = [];
  if (f.q) where.push(ilike(games.title, `%${f.q.replace(/[%_]/g, '\\$&')}%`));
  if (f.platform) where.push(arrayContains(games.platforms, [f.platform]));
  const rows = await db
    .select()
    .from(games)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(games.title))
    .limit(f.limit + 1)
    .offset(f.offset);
  const items = await hydrateGames(db, rows.slice(0, f.limit));
  return { items, next_offset: rows.length > f.limit ? f.offset + f.limit : null };
}

export async function getGame(db: Db, id: string): Promise<GameDto | null> {
  const [g] = await hydrateGames(db, await db.select().from(games).where(eq(games.id, id)));
  return g ?? null;
}

/** The emulator entry point: "I'm about to boot this dump — what mods exist for it?" */
export async function lookup(
  db: Db,
  ids: { kind: IdentifierKind; value: string }[],
  f: Omit<ModFilter, 'gameId' | 'identifier'>,
) {
  for (const { kind, value } of ids) {
    const normalized = normalizeIdentifier(kind, value);
    const [hit] = await db
      .select()
      .from(gameIdentifiers)
      .where(and(eq(gameIdentifiers.kind, kind), eq(gameIdentifiers.value, normalized)));
    if (!hit) continue;
    // A CRC32 or serial tagged with another platform is a different game
    if (f.platform && hit.platform && hit.platform !== f.platform) continue;
    const game = await getGame(db, hit.gameId);
    if (!game) continue;
    const matched = { kind, value: normalized };
    const list = await listMods(db, { ...f, gameId: game.id, identifier: matched });
    return { game, matched, mods: list };
  }
  return null;
}

export async function catalog(db: Db) {
  const [p, e, d] = await Promise.all([
    db.select().from(platforms).orderBy(asc(platforms.name)),
    db.select().from(emulators).orderBy(asc(emulators.name)),
    db.select().from(devices).orderBy(asc(devices.name)),
  ]);
  return { platforms: p, emulators: e, devices: d };
}

export async function fullIndex(db: Db) {
  const [cat, gameRows, modList] = await Promise.all([
    catalog(db),
    db.select().from(games).orderBy(asc(games.title)),
    listMods(db, {}),
  ]);
  return {
    generated_at: new Date().toISOString(),
    ...cat,
    games: await hydrateGames(db, gameRows),
    mods: modList,
  };
}

export async function lastSync(db: Db) {
  const [run] = await db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(1);
  return run ?? null;
}
