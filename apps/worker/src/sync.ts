import { createHash } from 'node:crypto';
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
  syncState,
  idsOwnedBy,
  writeGame,
  writeMod,
  type Db,
} from '@dsg/db';
import { normalizeIdentifier } from '@dsg/schema';
import { and, desc, eq, isNotNull, isNull, like, lt, ne, notInArray, or } from 'drizzle-orm';
import { GitHubClient, resolveReleases, type GhAsset } from './github.ts';
import { artworkSignature, fetchDat, indexDat, libretroArtwork, urlExists, type ArtworkMatch, type DatGame } from './artwork.ts';
import type { FetchLike } from './github.ts';
import { IgdbClient, igdbCoverUrl, igdbImageUrl, type TokenStore } from './igdb.ts';
import { autoCandidates, buildAutoMedia, extractImages, manifestMedia, rawUrl, resolveImageUrl } from './media.ts';
import type { Registry } from './registry.ts';

export type SyncOptions = {
  github?: GitHubClient;
  igdb?: IgdbClient | null;
  /** Hash assets that have no GitHub digest, up to this many bytes. 0 disables. */
  hashMaxBytes?: number;
  log?: (msg: string) => void;
  /** Used for libretro DATs and thumbnails (tests pass a fake). */
  fetch?: FetchLike;
};

const METADATA_TTL_MS = 30 * 24 * 3600 * 1000;

// Values are wrapped in an object: a bare JSON string would lose its quotes on the way through jsonb.
export async function getState<T>(db: Db, key: string): Promise<T | null> {
  const [row] = await db.select().from(syncState).where(eq(syncState.key, key));
  return ((row?.value as { v?: T } | undefined)?.v as T) ?? null;
}

export async function setState(db: Db, key: string, v: unknown): Promise<void> {
  const value = { v };
  await db
    .insert(syncState)
    .values({ key, value })
    .onConflictDoUpdate({ target: syncState.key, set: { value, updatedAt: new Date() } });
}

export function dbTokenStore(db: Db): TokenStore {
  return {
    get: () => getState(db, 'igdb_token'),
    set: (v) => setState(db, 'igdb_token', v),
  };
}

/**
 * Mirrors the registry into the database. Registry rows that left the registry are removed;
 * community rows (submitted on the website) are never touched, and a registry manifest
 * whose id is already taken by a community mod is skipped with an error.
 */
export async function syncRegistry(db: Db, reg: Registry): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  await db.transaction(async (tx) => {
    // DAT-derived identifiers are re-added by syncArtwork; dropping them first avoids clashes with manifest edits
    await tx.delete(gameIdentifiers).where(eq(gameIdentifiers.source, 'dat'));
    for (const p of reg.catalog.platforms) {
      const row = {
        id: p.id,
        name: p.name,
        manufacturer: p.manufacturer ?? null,
        kind: p.kind,
        screens: p.screens,
        externalIds: {
          igdb: p.igdb,
          screenscraper: p.screenscraper,
          retroachievements: p.retroachievements,
          launchbox: p.launchbox,
          thegamesdb: p.thegamesdb,
          libretro: p.libretro?.system,
          libretroDat: p.libretro?.dat,
          aliases: p.aliases,
        },
      };
      await tx.insert(platforms).values(row).onConflictDoUpdate({ target: platforms.id, set: row });
    }
    for (const e of reg.catalog.emulators) {
      const row = { ...e, homepage: e.homepage ?? null, paths: e.paths ?? null };
      await tx.insert(emulators).values(row).onConflictDoUpdate({ target: emulators.id, set: row });
    }
    for (const d of reg.catalog.devices) {
      const row = { ...d, resolutions: d.resolutions ?? null };
      await tx.insert(devices).values(row).onConflictDoUpdate({ target: devices.id, set: row });
    }

    for (const g of reg.games) {
      await writeGame(
        tx,
        {
          id: g.id,
          title: g.title,
          platforms: g.platforms,
          // Keep an IGDB id resolved by the worker unless the manifest pins one
          igdbId: g.igdb ?? undefined,
          identifiers: g.identifiers.map((i) => ({ ...i, value: normalizeIdentifier(i.kind, i.value) })),
        },
        { origin: 'registry' },
      );
    }

    const taken = await idsOwnedBy(tx, 'mods', reg.mods.map((m) => m.id), 'community');
    for (const m of reg.mods) {
      if (taken.has(m.id)) {
        errors.push(`mod ${m.id}: id already used by a community mod, manifest skipped`);
        continue;
      }
      await writeMod(
        tx,
        {
          id: m.id,
          name: m.name,
          type: m.type,
          summary: m.summary,
          description: m.description,
          gameId: m.game,
          authors: m.authors,
          license: m.license,
          homepage: m.homepage,
          tags: m.tags,
          requires: m.requires,
          devices: m.devices,
          source: m.source,
          install: m.install,
          targets: m.targets.map((t) => ({
            platform: t.platform,
            emulator: t.emulator,
            minVersion: t.min_version,
            maxVersion: t.max_version,
            identifiers: t.identifiers.map((i) => ({ kind: i.kind, value: normalizeIdentifier(i.kind, i.value) })),
          })),
        },
        { source: 'manifest', rows: manifestMedia(m) },
        { origin: 'registry' },
      );
    }

    const registryOnly = (col: typeof mods.origin) => eq(col, 'registry');
    // Forget cached ETags/signatures of removed mods, so re-adding one starts from scratch
    const removed = await tx
      .select({ id: mods.id })
      .from(mods)
      .where(and(registryOnly(mods.origin), notInArray(mods.id, reg.mods.map((m) => m.id))));
    for (const { id } of removed) {
      await tx
        .delete(syncState)
        .where(
          or(
            like(syncState.key, `gh_etag:${id}:%`),
            like(syncState.key, `readme:${id}:%`),
            eq(syncState.key, `release_images:${id}`),
            eq(syncState.key, `media_sig:${id}`),
          ),
        );
    }
    // notInArray with an empty list matches everything, which is what an empty registry means
    await tx.delete(mods).where(and(registryOnly(mods.origin), notInArray(mods.id, reg.mods.map((m) => m.id))));
    // A registry game that community mods still point at stays
    const usedByCommunity = tx.select({ id: mods.gameId }).from(mods).where(and(eq(mods.origin, 'community'), isNotNull(mods.gameId)));
    await tx
      .delete(games)
      .where(
        and(
          eq(games.origin, 'registry'),
          notInArray(games.id, reg.games.map((g) => g.id)),
          notInArray(games.id, usedByCommunity),
        ),
      );
    await tx.delete(emulators).where(notInArray(emulators.id, reg.catalog.emulators.map((e) => e.id)));
    await tx.delete(devices).where(notInArray(devices.id, reg.catalog.devices.map((d) => d.id)));
    await tx.delete(platforms).where(notInArray(platforms.id, reg.catalog.platforms.map((p) => p.id)));
  });
  return { errors };
}

/** Pulls releases for every mod; unchanged repos cost nothing thanks to ETags. */
export async function syncReleases(db: Db, reg: Registry, opts: SyncOptions = {}): Promise<{ updated: number; errors: string[] }> {
  const gh = opts.github ?? new GitHubClient();
  const log = opts.log ?? (() => {});
  const errors: string[] = [];
  let updated = 0;

  for (const m of reg.mods) {
    // The key changes with the source rules, so editing asset patterns forces a refetch
    const sourceHash = createHash('sha1').update(JSON.stringify(m.source)).digest('hex').slice(0, 12);
    const etagKey = `gh_etag:${m.id}:${sourceHash}`;
    try {
      // Only trust the ETag while we still hold releases (a mod removed and re-added starts empty)
      const [held] = await db.select({ id: modReleases.id }).from(modReleases).where(eq(modReleases.modId, m.id)).limit(1);
      const etag = held ? ((await getState<string>(db, etagKey)) ?? undefined) : undefined;
      const res = await gh.releases(m.source.github, etag);
      if (res.notModified) continue;

      const resolved = resolveReleases(m, res.releases);
      for (const r of resolved) {
        if (opts.hashMaxBytes) {
          for (const a of r.assets) {
            if (!a.sha256 && a.size <= opts.hashMaxBytes) a.sha256 = await gh.sha256OfUrl(a.url, opts.hashMaxBytes);
          }
        }
      }

      await db.transaction(async (tx) => {
        for (const r of resolved) {
          const values = {
            modId: m.id,
            tag: r.tag,
            version: r.version,
            name: r.name,
            prerelease: r.prerelease,
            publishedAt: r.publishedAt,
            changelog: r.changelog,
            htmlUrl: r.htmlUrl,
          };
          const [rel] = await tx
            .insert(modReleases)
            .values(values)
            .onConflictDoUpdate({ target: [modReleases.modId, modReleases.tag], set: values })
            .returning({ id: modReleases.id });
          await tx.delete(releaseAssets).where(eq(releaseAssets.releaseId, rel!.id));
          await tx.insert(releaseAssets).values(r.assets.map((a) => ({ ...a, releaseId: rel!.id })));
        }
        await tx.delete(modReleases).where(
          and(
            eq(modReleases.modId, m.id),
            notInArray(
              modReleases.tag,
              resolved.map((r) => r.tag),
            ),
          ),
        );
        await tx
          .update(mods)
          .set({ lastReleaseAt: resolved[0]?.publishedAt ?? null })
          .where(eq(mods.id, m.id));
      });

      // Remember the images attached to the newest release: the media step looks at them
      const newestTag = resolved[0]?.tag;
      const newest = res.releases.find((r) => r.tag_name === newestTag) ?? res.releases.find((r) => !r.draft);
      await setState(db, `release_images:${m.id}`, (newest?.assets ?? []).map((a) => ({ name: a.name, browser_download_url: a.browser_download_url })));

      const repo = await gh.repo(m.source.github).catch(() => null);
      if (repo) await db.update(mods).set({ stars: repo.stargazers_count }).where(eq(mods.id, m.id));
      if (res.etag) await setState(db, etagKey, res.etag);
      updated++;
      log(`releases ${m.id}: ${resolved.length} usable release(s)`);
    } catch (e) {
      errors.push(`releases ${m.id}: ${(e as Error).message}`);
    }
  }
  return { updated, errors };
}

// Automatic media sits after the manifest's own images
const AUTO_POSITION = 1000;
const AUTO_PAIR = 1000;

/**
 * Finds screenshots in the README, the latest release notes and image assets.
 * Only re-probes images when the candidate list changed since the last run.
 */
export async function syncMedia(db: Db, reg: Registry, opts: SyncOptions = {}): Promise<{ updated: number; errors: string[] }> {
  const gh = opts.github ?? new GitHubClient();
  const errors: string[] = [];
  let updated = 0;
  for (const m of reg.mods) {
    const auto = and(eq(modMedia.modId, m.id), ne(modMedia.source, 'manifest'));
    if (!m.source.auto_media) {
      await db.delete(modMedia).where(auto);
      continue;
    }
    try {
      const readmeKey = `readme:${m.id}:${m.source.github}`;
      const cached = await getState<{ etag: string | null; images: { url: string; alt?: string }[] }>(db, readmeKey);
      const readme = await gh.readme(m.source.github, cached?.etag ?? undefined);
      let readmeImages = cached?.images ?? [];
      if (readme === null) readmeImages = [];
      else if (!readme.notModified) {
        readmeImages = extractImages(readme.text).flatMap((i) => {
          const url = resolveImageUrl(i.url, readme.downloadUrl);
          return url ? [{ url, alt: i.alt }] : [];
        });
        await setState(db, readmeKey, { etag: readme.etag, images: readmeImages });
      }

      const [latest] = await db
        .select({ changelog: modReleases.changelog })
        .from(modReleases)
        .where(eq(modReleases.modId, m.id))
        .orderBy(desc(modReleases.publishedAt))
        .limit(1);
      const assets = (await getState<Pick<GhAsset, 'name' | 'browser_download_url'>[]>(db, `release_images:${m.id}`)) ?? [];
      const candidates = autoCandidates({
        releaseNotes: latest?.changelog ?? null,
        releaseNotesBase: rawUrl(m.source.github, 'README.md'),
        readme: readmeImages,
        assets,
        exclude: manifestMedia(m).map((r) => r.url),
      });

      const sigKey = `media_sig:${m.id}`;
      const sig = createHash('sha1').update(JSON.stringify(candidates)).digest('hex');
      if ((await getState<string>(db, sigKey)) === sig) continue;

      const rows = await buildAutoMedia(candidates, (url) => gh.imageHead(url), AUTO_POSITION, AUTO_PAIR);
      await db.transaction(async (tx) => {
        await tx.delete(modMedia).where(auto);
        if (rows.length) await tx.insert(modMedia).values(rows.map((r) => ({ ...r, modId: m.id })));
      });
      await setState(db, sigKey, sig);
      updated++;
    } catch (e) {
      errors.push(`media ${m.id}: ${(e as Error).message}`);
    }
  }
  return { updated, errors };
}

const ARTWORK_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * Recognises each game's dumps in libretro-database DATs: adds the sibling hashes/serial
 * as identifiers and links libretro-thumbnails box art, snaps and title screens.
 * DATs are only downloaded when a game's identifiers changed or its match is a week old.
 */
export async function syncArtwork(db: Db, reg: Registry, opts: SyncOptions = {}): Promise<{ updated: number; errors: string[] }> {
  const fetchImpl = opts.fetch ?? fetch;
  const errors: string[] = [];
  let updated = 0;
  const dats = new Map<string, Map<string, DatGame> | null>();
  const datFor = async (p: (typeof reg.catalog.platforms)[number]) => {
    if (!p.libretro) return null;
    if (!dats.has(p.id)) {
      try {
        dats.set(p.id, indexDat(await fetchDat(fetchImpl, p.libretro)));
      } catch (e) {
        errors.push((e as Error).message);
        dats.set(p.id, null);
      }
    }
    return dats.get(p.id)!;
  };

  for (const g of reg.games) {
    if (!g.identifiers.length) continue;
    try {
      const key = `artwork:${g.id}`;
      const cached = await getState<{ sig: string; at: number; match: ArtworkMatch | null }>(db, key);
      let match: ArtworkMatch | null = null;
      const candidates = reg.catalog.platforms.filter((p) => p.libretro && g.platforms.includes(p.id));
      const sig = candidates.map((p) => artworkSignature(g, p)).join(',');
      if (cached && cached.sig === sig && Date.now() - cached.at < ARTWORK_TTL_MS) {
        match = cached.match;
      } else {
        for (const p of candidates) {
          const idx = await datFor(p);
          if (!idx) continue;
          match = await libretroArtwork(g, p, idx, (url) => urlExists(fetchImpl, url));
          if (match) break;
        }
        await setState(db, key, { sig, at: Date.now(), match });
        updated++;
      }

      await db.transaction(async (tx) => {
        await tx.delete(gameIdentifiers).where(and(eq(gameIdentifiers.gameId, g.id), eq(gameIdentifiers.source, 'dat')));
        await tx.delete(gameMedia).where(and(eq(gameMedia.gameId, g.id), eq(gameMedia.source, 'libretro')));
        if (!match) return;
        if (match.identifiers.length) {
          // Manifest identifiers win: existing (kind, value) pairs are skipped
          await tx
            .insert(gameIdentifiers)
            .values(match.identifiers.map((i) => ({ gameId: g.id, ...i, source: 'dat' })))
            .onConflictDoNothing();
        }
        if (match.media.length) {
          await tx
            .insert(gameMedia)
            .values(match.media.map((m, i) => ({ gameId: g.id, kind: m.kind, url: m.url, source: 'libretro', position: 100 + i })));
        }
      });
    } catch (e) {
      errors.push(`artwork ${g.id}: ${(e as Error).message}`);
    }
  }
  return { updated, errors };
}

/** Fills title metadata from IGDB for games never synced or older than 30 days. */
export async function syncMetadata(db: Db, reg: Registry, igdb: IgdbClient): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;
  const stale = await db
    .select({ id: games.id, igdbId: games.igdbId })
    .from(games)
    .where(or(isNull(games.metadataSyncedAt), lt(games.metadataSyncedAt, new Date(Date.now() - METADATA_TTL_MS))));

  for (const row of stale) {
    const manifest = reg.games.find((g) => g.id === row.id);
    if (!manifest) continue;
    try {
      const platformIds = reg.catalog.platforms.filter((p) => manifest.platforms.includes(p.id) && p.igdb).map((p) => p.igdb!);
      const id = row.igdbId ?? (await igdb.resolveId(manifest, platformIds));
      const meta = id ? await igdb.game(id) : null;
      const media = [
        ...(meta?.cover ? [{ kind: 'cover', img: meta.cover, size: 't_cover_big' }] : []),
        ...(meta?.artworks ?? []).slice(0, 3).map((img) => ({ kind: 'artwork', img, size: 't_1080p' })),
        ...(meta?.screenshots ?? []).slice(0, 6).map((img) => ({ kind: 'screenshot', img, size: 't_screenshot_big' })),
      ];
      await db.transaction(async (tx) => {
        await tx.delete(gameMedia).where(and(eq(gameMedia.gameId, row.id), eq(gameMedia.source, 'igdb')));
        if (media.length) {
          await tx.insert(gameMedia).values(
            media.map((m, position) => ({
              gameId: row.id,
              kind: m.kind,
              url: igdbImageUrl(m.img.image_id, m.size),
              source: 'igdb',
              width: m.img.width ?? null,
              height: m.img.height ?? null,
              position,
            })),
          );
        }
      });
      await db
        .update(games)
        .set({
          igdbId: id,
          summary: meta?.summary ?? null,
          coverUrl: meta?.cover ? igdbCoverUrl(meta.cover.image_id) : null,
          releaseYear: meta?.first_release_date ? new Date(meta.first_release_date * 1000).getUTCFullYear() : null,
          metadataSyncedAt: new Date(),
        })
        .where(eq(games.id, row.id));
      updated++;
    } catch (e) {
      errors.push(`igdb ${row.id}: ${(e as Error).message}`);
    }
  }
  return { updated, errors };
}

export async function runSync(db: Db, reg: Registry, opts: SyncOptions = {}) {
  const log = opts.log ?? console.log;
  const [run] = await db.insert(syncRuns).values({}).returning({ id: syncRuns.id });
  const errors: string[] = [];
  const stats: Record<string, number> = { games: reg.games.length, mods: reg.mods.length };
  try {
    errors.push(...(await syncRegistry(db, reg)).errors);
    const art = await syncArtwork(db, reg, opts);
    stats.artworkUpdated = art.updated;
    errors.push(...art.errors);
    const rel = await syncReleases(db, reg, { ...opts, log });
    stats.releasesUpdated = rel.updated;
    errors.push(...rel.errors);
    const media = await syncMedia(db, reg, opts);
    stats.mediaUpdated = media.updated;
    errors.push(...media.errors);
    const igdb = opts.igdb === undefined ? IgdbClient.fromEnv(dbTokenStore(db)) : opts.igdb;
    if (igdb) {
      const meta = await syncMetadata(db, reg, igdb);
      stats.metadataUpdated = meta.updated;
      errors.push(...meta.errors);
    } else {
      log('IGDB credentials missing: skipping game metadata');
    }
  } catch (e) {
    errors.push((e as Error).message);
  }
  const status = errors.length ? 'partial' : 'ok';
  await db
    .update(syncRuns)
    .set({ finishedAt: new Date(), status, stats, errors })
    .where(eq(syncRuns.id, run!.id));
  for (const e of errors) log(`error: ${e}`);
  log(`sync ${status}: ${JSON.stringify(stats)}`);
  return { status, stats, errors };
}
