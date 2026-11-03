import {
  devices,
  emulators,
  gameIdentifiers,
  gameMedia,
  games,
  modMedia,
  modReleases,
  mods,
  modTargets,
  platforms,
  releaseAssets,
  syncRuns,
  compatReports,
  users,
  isGithubSource,
  type Db,
} from '@dsg/db';
import { normalizeIdentifier, type IdentifierKind } from '@dsg/schema';
import { and, arrayContains, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { GameDto, MediaDto, ModDto, ReleaseDto } from './dto.ts';
import { installStats, popularity } from './installs.ts';
import { compatSummaries, emptySummary } from './reports.ts';
import { deviceMatches, targetMatches, type MatchQuery, type TargetRow } from './match.ts';

type ModRow = typeof mods.$inferSelect;
type GameRow = typeof games.$inferSelect;

export type ModFilter = MatchQuery & { gameId?: string; type?: string; device?: string; q?: string; sort?: 'recent' | 'popular' };
type LookupFilter = Omit<ModFilter, 'gameId' | 'identifiers'>;

/** Groups rows by key once, instead of filtering the whole list for every parent. */
function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

async function releasesFor(db: Db, releaseRows: (typeof modReleases.$inferSelect)[]): Promise<Map<number, ReleaseDto>> {
  const out = new Map<number, ReleaseDto>();
  if (!releaseRows.length) return out;
  const assets = await db
    .select()
    .from(releaseAssets)
    .where(inArray(releaseAssets.releaseId, releaseRows.map((r) => r.id)))
    .orderBy(asc(releaseAssets.id));
  const byRelease = groupBy(assets, (a) => a.releaseId);
  for (const r of releaseRows) {
    out.set(r.id, {
      tag: r.tag,
      version: r.version,
      name: r.name,
      prerelease: r.prerelease,
      published_at: r.publishedAt.toISOString(),
      html_url: r.htmlUrl,
      changelog: r.changelog,
      assets: (byRelease.get(r.id) ?? []).map((a) => ({ role: a.role, name: a.name, url: a.url, size: a.size, sha256: a.sha256, content_type: a.contentType })),
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
  const [targets, latest, media, covers, gameArt] = await Promise.all([
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
    gameIds.length
      ? db.select().from(gameMedia).where(inArray(gameMedia.gameId, gameIds)).orderBy(asc(gameMedia.position))
      : Promise.resolve([]),
  ]);
  const [releases, compat, installs] = await Promise.all([releasesFor(db, latest), compatSummaries(db, ids), installStats(db, ids)]);
  const targetsBy = groupBy(targets, (x) => x.modId);
  const latestBy = new Map(latest.map((r) => [r.modId, r]));
  const mediaBy = groupBy(media, (x) => x.modId);
  const coverBy = new Map(covers.map((c) => [c.id, c.coverUrl]));
  const artBy = groupBy(gameArt, (a) => a.gameId);
  return rows.map((m) => {
    const t = targetsBy.get(m.id) ?? [];
    const rel = latestBy.get(m.id);
    const own = mediaBy.get(m.id) ?? [];
    const { gallery, previews } = shapeMedia(own);
    // Community uploads: the submitter's chosen cover sits at the lowest position (rows come sorted by position)
    const uploaded = own.find((x) => x.source === 'upload' && x.kind !== 'bottom');
    const cover =
      uploaded?.url ??
      gallery.find((g) => g.source === 'manifest')?.url ??
      previews[0]?.top.url ??
      gallery[0]?.url ??
      // A mod card is landscape: the game's screenshot fits better than its box art
      (m.gameId ? pickGameArt(coverBy.get(m.gameId) ?? null, artBy.get(m.gameId) ?? []) : null)?.screenshot ??
      (m.gameId ? coverBy.get(m.gameId) : null) ??
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
      origin: m.origin as ModDto['origin'],
      source_repo: isGithubSource(m.source) ? m.source.github : null,
      source_url: isGithubSource(m.source)
        ? `https://github.com/${m.source.github}`
        : (m.source.page_url ?? m.homepage ?? null),
      // Community mods without a direct file link must be fetched by hand from source_url
      manual_download: !isGithubSource(m.source) && !(rel && releases.get(rel.id)?.assets.length),
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
      compat: compat.get(m.id) ?? emptySummary(),
      installs: installs.get(m.id) ?? { total: 0, last_30_days: 0 },
      updated_at: m.updatedAt.toISOString(),
      _targets: t,
    };
  });
}

const strip = ({ _targets, ...m }: ModDto & { _targets: unknown }): ModDto => m;

type Hydrated = Awaited<ReturnType<typeof hydrateMods>>[number];

/** Applies device / platform / emulator / dump filters to hydrated mods. */
export function filterMods(list: (ModDto & { _targets: TargetRow[] })[], f: ModFilter): ModDto[] {
  return list
    .filter((m) => deviceMatches(m.devices, f.device))
    .filter((m) => !(f.platform || f.emulator || f.identifiers?.length) || m._targets.some((t) => targetMatches(t, f)))
    .map(strip);
}

export async function listMods(db: Db, f: ModFilter): Promise<ModDto[]> {
  const where: SQL[] = [eq(mods.published, true)];
  if (f.gameId) where.push(eq(mods.gameId, f.gameId));
  if (f.type) where.push(eq(mods.type, f.type));
  if (f.q) where.push(ilike(mods.name, `%${f.q.replace(/[%_]/g, '\\$&')}%`));
  const rows = await db
    .select()
    .from(mods)
    .where(and(...where))
    .orderBy(
      ...(f.sort === 'popular' ? [sql`${popularity()} desc`] : []),
      sql`${mods.lastReleaseAt} desc nulls last`,
      asc(mods.name),
    );
  return filterMods(await hydrateMods(db, rows), f);
}

/** Published mods of many games at once, still unfiltered (for batch lookups). */
export async function modsForGames(db: Db, gameIds: string[]): Promise<Hydrated[]> {
  if (!gameIds.length) return [];
  const rows = await db
    .select()
    .from(mods)
    .where(and(eq(mods.published, true), inArray(mods.gameId, gameIds)))
    .orderBy(sql`${mods.lastReleaseAt} desc nulls last`, asc(mods.name));
  return hydrateMods(db, rows);
}

export async function getMod(db: Db, id: string, opts: { includeUnpublished?: boolean } = {}): Promise<ModDto | null> {
  const rows = await db
    .select()
    .from(mods)
    .where(opts.includeUnpublished ? eq(mods.id, id) : and(eq(mods.id, id), eq(mods.published, true)));
  const [m] = await hydrateMods(db, rows);
  return m ? strip(m) : null;
}

/** Several published mods by id, in one hydration. */
export async function getMods(db: Db, ids: string[]): Promise<Map<string, Hydrated>> {
  if (!ids.length) return new Map();
  const rows = await db.select().from(mods).where(and(inArray(mods.id, ids), eq(mods.published, true)));
  return new Map((await hydrateMods(db, rows)).map((m) => [m.id, m]));
}

export async function getReleases(db: Db, modId: string): Promise<ReleaseDto[]> {
  const rows = await db.select().from(modReleases).where(eq(modReleases.modId, modId)).orderBy(desc(modReleases.publishedAt));
  const map = await releasesFor(db, rows);
  return rows.map((r) => map.get(r.id)!);
}

async function hydrateGames(db: Db, rows: GameRow[]): Promise<GameDto[]> {
  if (!rows.length) return [];
  const ids = rows.map((g) => g.id);
  const [idents, counts, media] = await Promise.all([
    db.select().from(gameIdentifiers).where(inArray(gameIdentifiers.gameId, ids)).orderBy(asc(gameIdentifiers.id)),
    db
      .select({ gameId: mods.gameId, n: sql<number>`count(*)::int` })
      .from(mods)
      .where(and(inArray(mods.gameId, ids), eq(mods.published, true)))
      .groupBy(mods.gameId),
    db.select().from(gameMedia).where(inArray(gameMedia.gameId, ids)).orderBy(asc(gameMedia.position)),
  ]);
  const identsBy = groupBy(idents, (i) => i.gameId);
  const countBy = new Map(counts.map((c) => [c.gameId, c.n]));
  const mediaBy = groupBy(media, (m) => m.gameId);
  return rows.map((g) => {
    const gm = mediaBy.get(g.id) ?? [];
    const art = pickGameArt(g.coverUrl, gm);
    return {
    id: g.id,
    title: g.title,
    platforms: g.platforms,
    igdb_id: g.igdbId,
    summary: g.summary,
    cover_url: art.cover,
    hero_url: art.hero,
    media: gm.map((m) => ({
      kind: m.kind as GameDto['media'][number]['kind'],
      url: m.url,
      width: m.width,
      height: m.height,
      source: m.source as GameDto['media'][number]['source'],
    })),
    release_year: g.releaseYear,
    identifiers: (identsBy.get(g.id) ?? []).map((i) => ({
        kind: i.kind as IdentifierKind,
        value: i.value,
        platform: i.platform,
        region: i.region,
        label: i.label,
        source: i.source as 'manifest' | 'dat',
      })),
    mod_count: countBy.get(g.id) ?? 0,
    };
  });
}

/** Cover: IGDB cover, else box art. Hero: key art, else a screenshot, else the title screen. */
function pickGameArt(igdbCover: string | null, media: (typeof gameMedia.$inferSelect)[]) {
  const first = (kind: string) => media.find((m) => m.kind === kind)?.url ?? null;
  return {
    cover: igdbCover ?? first('cover'),
    hero: first('artwork') ?? first('screenshot') ?? first('title'),
    screenshot: first('screenshot') ?? first('title'),
  };
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

export type LookupKeys = {
  /** Tried in order: the first known one wins */
  identifiers: { kind: IdentifierKind; value: string }[];
  igdb?: number;
  /** A No-Intro / Redump file name, with or without path and extension */
  filename?: string;
};

type GameHit = { gameId: string; matched: { kind: string; value: string }; same: { kind: string; value: string }[] };

/** "Legend of Zelda, The - The Minish Cap (USA).gba" or a full path -> DAT entry name. */
export function datNameFromFilename(name: string): string {
  const base = name.split(/[\\/]/).pop()!.trim();
  return base.replace(/\.(zip|7z|[a-z0-9]{2,4})$/i, '');
}

const sameDump = (siblingOf: string | null) => {
  if (!siblingOf) return [];
  const [k, ...v] = siblingOf.split(':');
  return [{ kind: k!, value: v.join(':') }];
};

/**
 * Finds the game for many sets of keys with a constant number of queries (one per identifier kind
 * present, one for file names, one for IGDB ids), honouring the same precedence as a single lookup.
 */
export async function findGames(db: Db, list: LookupKeys[], platform?: string): Promise<(GameHit | null)[]> {
  const normalized = list.map((k) => k.identifiers.map(({ kind, value }) => ({ kind, value: normalizeIdentifier(kind, value) })));
  const byKind = new Map<string, Set<string>>();
  for (const ids of normalized) for (const i of ids) (byKind.get(i.kind) ?? byKind.set(i.kind, new Set()).get(i.kind)!).add(i.value);
  const names = [...new Set(list.flatMap((k) => (k.filename ? [datNameFromFilename(k.filename)] : [])))];
  const igdbIds = [...new Set(list.flatMap((k) => (k.igdb ? [k.igdb] : [])))];

  const [idRows, nameRows, igdbRows] = await Promise.all([
    byKind.size
      ? db
          .select()
          .from(gameIdentifiers)
          .where(or(...[...byKind].map(([kind, values]) => and(eq(gameIdentifiers.kind, kind), inArray(gameIdentifiers.value, [...values])))))
      : Promise.resolve([]),
    names.length
      ? db.select().from(gameIdentifiers).where(and(inArray(gameIdentifiers.label, names), eq(gameIdentifiers.source, 'dat')))
      : Promise.resolve([]),
    igdbIds.length
      ? db.select({ id: games.id, igdb: games.igdbId, platforms: games.platforms }).from(games).where(inArray(games.igdbId, igdbIds))
      : Promise.resolve([]),
  ]);
  const idIndex = groupBy(idRows, (r) => `${r.kind}:${r.value}`);
  const nameIndex = groupBy(nameRows, (r) => r.label!);
  const okPlatform = (p: string | null) => !platform || !p || p === platform;

  return list.map((keys, n): GameHit | null => {
    for (const matched of normalized[n]!) {
      // A CRC32 or serial tagged with another platform is a different game
      const hit = idIndex.get(`${matched.kind}:${matched.value}`)?.find((r) => okPlatform(r.platform));
      // An identifier added from the DAT (e.g. crc32) stands for the manifest identifier of the same dump
      if (hit) return { gameId: hit.gameId, matched, same: [matched, ...sameDump(hit.siblingOf)] };
    }
    if (keys.filename) {
      const label = datNameFromFilename(keys.filename);
      const hit = nameIndex.get(label)?.find((r) => okPlatform(r.platform));
      if (hit) return { gameId: hit.gameId, matched: { kind: 'filename', value: label }, same: sameDump(hit.siblingOf) };
    }
    if (keys.igdb) {
      const g = igdbRows.find((r) => r.igdb === keys.igdb && (!platform || r.platforms.includes(platform)));
      // An IGDB id names the game, not a dump: mods restricted to specific dumps still match
      if (g) return { gameId: g.id, matched: { kind: 'igdb', value: String(keys.igdb) }, same: [] };
    }
    return null;
  });
}

export async function findGame(db: Db, keys: LookupKeys, platform?: string): Promise<GameHit | null> {
  return (await findGames(db, [keys], platform))[0]!;
}

/** The emulator entry point: "I'm about to boot this dump — what mods exist for it?" */
export async function lookup(db: Db, keys: LookupKeys, f: LookupFilter) {
  const hit = await findGame(db, keys, f.platform);
  if (!hit) return null;
  const game = await getGame(db, hit.gameId);
  if (!game) return null;
  const list = await listMods(db, { ...f, gameId: game.id, identifiers: hit.same.length ? hit.same : undefined });
  return { game, matched: hit.matched, mods: list };
}

let platformCache: { at: number; rows: (typeof platforms.$inferSelect)[] } | null = null;

/**
 * Accepts our platform id, an alias (`n3ds`) or another catalog's id:
 * `igdb:24`, `ra:5`, `screenscraper:12`, `launchbox:Nintendo DS`, `libretro:Nintendo - Game Boy Advance`, `thegamesdb:5`.
 */
export async function resolvePlatform(db: Db, value: string): Promise<string | null> {
  if (!platformCache || Date.now() - platformCache.at > 60_000) {
    platformCache = { at: Date.now(), rows: await db.select().from(platforms) };
  }
  const v = value.trim();
  const lower = v.toLowerCase();
  const m = v.match(/^([a-z]+):(.+)$/i);
  for (const p of platformCache.rows) {
    const x = p.externalIds;
    if (p.id === lower || x.aliases?.includes(lower)) return p.id;
    if (!m) continue;
    const [, ns, id] = m as unknown as [string, string, string];
    switch (ns.toLowerCase()) {
      case 'igdb':
        if (x.igdb === Number(id)) return p.id;
        break;
      case 'ra':
      case 'retroachievements':
        if (x.retroachievements?.includes(Number(id))) return p.id;
        break;
      case 'ss':
      case 'screenscraper':
        if (x.screenscraper === Number(id)) return p.id;
        break;
      case 'tgdb':
      case 'thegamesdb':
        if (x.thegamesdb === Number(id)) return p.id;
        break;
      case 'launchbox':
        if (x.launchbox?.toLowerCase() === id.toLowerCase()) return p.id;
        break;
      case 'libretro':
        if (x.libretro?.toLowerCase() === id.toLowerCase()) return p.id;
        break;
    }
  }
  return null;
}

export function clearPlatformCache() {
  platformCache = null;
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

/** A device with how many mods target it and what players reported on it. */
export async function getDevice(db: Db, idOrAlias: string) {
  const all = await db.select().from(devices);
  const d = all.find((x) => x.id === idOrAlias || x.aliases.includes(idOrAlias.toLowerCase()));
  if (!d) return null;
  const [[count], reports] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(mods)
      .where(and(eq(mods.published, true), arrayContains(mods.devices, [d.id]))),
    db
      .select({ result: compatReports.result, n: sql<number>`count(*)::int` })
      .from(compatReports)
      .innerJoin(users, eq(users.id, compatReports.userId))
      .where(and(eq(compatReports.device, d.id), eq(compatReports.hidden, false), eq(users.banned, false)))
      .groupBy(compatReports.result),
  ]);
  const r = { works: 0, issues: 0, broken: 0 };
  for (const x of reports) r[x.result as keyof typeof r] = x.n;
  return { ...d, mod_count: count?.n ?? 0, reports: r };
}

export async function lastSync(db: Db) {
  const [run] = await db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(1);
  return run ?? null;
}
