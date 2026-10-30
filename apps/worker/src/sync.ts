import { createHash } from 'node:crypto';
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
  syncState,
  type Db,
} from '@dsg/db';
import { normalizeIdentifier } from '@dsg/schema';
import { and, desc, eq, isNull, like, lt, ne, notInArray, or } from 'drizzle-orm';
import { GitHubClient, resolveReleases, type GhAsset } from './github.ts';
import { IgdbClient, igdbCoverUrl, type TokenStore } from './igdb.ts';
import { autoCandidates, buildAutoMedia, extractImages, manifestMedia, rawUrl, resolveImageUrl } from './media.ts';
import type { Registry } from './registry.ts';

export type SyncOptions = {
  github?: GitHubClient;
  igdb?: IgdbClient | null;
  /** Hash assets that have no GitHub digest, up to this many bytes. 0 disables. */
  hashMaxBytes?: number;
  log?: (msg: string) => void;
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

/** Mirrors the registry into the database. Rows that left the registry are removed. */
export async function syncRegistry(db: Db, reg: Registry): Promise<void> {
  await db.transaction(async (tx) => {
    for (const p of reg.catalog.platforms) {
      await tx.insert(platforms).values(p).onConflictDoUpdate({ target: platforms.id, set: p });
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
      const row = { id: g.id, title: g.title, platforms: g.platforms, igdbId: g.igdb ?? null };
      // Keep an IGDB id resolved by the worker unless the manifest pins one
      const set = g.igdb ? { ...row, updatedAt: new Date() } : { title: g.title, platforms: g.platforms, updatedAt: new Date() };
      await tx.insert(games).values(row).onConflictDoUpdate({ target: games.id, set });
      await tx.delete(gameIdentifiers).where(eq(gameIdentifiers.gameId, g.id));
      if (g.identifiers.length) {
        await tx.insert(gameIdentifiers).values(
          g.identifiers.map((i) => ({
            gameId: g.id,
            kind: i.kind,
            value: normalizeIdentifier(i.kind, i.value),
            platform: i.platform ?? null,
            region: i.region ?? null,
            label: i.label ?? null,
          })),
        );
      }
    }

    for (const m of reg.mods) {
      const row = {
        id: m.id,
        name: m.name,
        type: m.type,
        summary: m.summary,
        description: m.description ?? null,
        gameId: m.game ?? null,
        authors: m.authors,
        license: m.license,
        homepage: m.homepage ?? null,
        tags: m.tags,
        requires: m.requires,
        devices: m.devices,
        source: m.source,
        install: m.install,
      };
      await tx.insert(mods).values(row).onConflictDoUpdate({ target: mods.id, set: { ...row, updatedAt: new Date() } });
      await tx.delete(modMedia).where(and(eq(modMedia.modId, m.id), eq(modMedia.source, 'manifest')));
      const media = manifestMedia(m);
      if (media.length) await tx.insert(modMedia).values(media.map((r) => ({ ...r, modId: m.id })));
      await tx.delete(modTargets).where(eq(modTargets.modId, m.id));
      await tx.insert(modTargets).values(
        m.targets.map((t) => ({
          modId: m.id,
          platform: t.platform,
          emulator: t.emulator ?? null,
          minVersion: t.min_version ?? null,
          maxVersion: t.max_version ?? null,
          identifiers: t.identifiers.map((i) => ({ kind: i.kind, value: normalizeIdentifier(i.kind, i.value) })),
        })),
      );
    }

    // Forget cached ETags/signatures of removed mods, so re-adding one starts from scratch
    const removed = await tx.select({ id: mods.id }).from(mods).where(notInArray(mods.id, reg.mods.map((m) => m.id)));
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
    await tx.delete(mods).where(notInArray(mods.id, reg.mods.map((m) => m.id)));
    await tx.delete(games).where(notInArray(games.id, reg.games.map((g) => g.id)));
    await tx.delete(emulators).where(notInArray(emulators.id, reg.catalog.emulators.map((e) => e.id)));
    await tx.delete(devices).where(notInArray(devices.id, reg.catalog.devices.map((d) => d.id)));
    await tx.delete(platforms).where(notInArray(platforms.id, reg.catalog.platforms.map((p) => p.id)));
  });
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
      const id = row.igdbId ?? (await igdb.resolveId(manifest));
      const meta = id ? await igdb.game(id) : null;
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
    await syncRegistry(db, reg);
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
