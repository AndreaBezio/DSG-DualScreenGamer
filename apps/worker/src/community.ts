// Worker steps for community submissions and optional catalogs.
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { gameIdentifiers, modMedia, modReleases, mods, releaseAssets, submissions, uploads, type Db } from '@dsg/db';
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { guardedFetch, type UrlGuard } from '@dsg/net';
import type { FetchLike } from './github.ts';
import type { Registry } from './registry.ts';
import { getState, setState } from './sync.ts';

const RETRY_MS = 24 * 3600 * 1000;

/**
 * Community mods link files directly: fill in size, content type and sha256 by downloading
 * each file once (up to maxBytes). Failures are retried a day later.
 */
export async function syncCommunityFiles(
  db: Db,
  opts: { fetch?: FetchLike; maxBytes?: number; guard?: UrlGuard } = {},
): Promise<{ updated: number; errors: string[] }> {
  const fetchImpl = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? 512 * 1048576;
  const errors: string[] = [];
  let updated = 0;
  const rows = await db
    .select({ a: releaseAssets })
    .from(releaseAssets)
    .innerJoin(modReleases, eq(modReleases.id, releaseAssets.releaseId))
    .innerJoin(mods, eq(mods.id, modReleases.modId))
    .where(and(eq(mods.origin, 'community'), sql`${releaseAssets.sha256} is null`));

  for (const { a } of rows) {
    const key = `file_checked:${a.id}`;
    const last = await getState<number>(db, key);
    if (last && Date.now() - last < RETRY_MS) continue;
    try {
      // Links come from users: only public hosts, checked on every redirect
      const res = await guardedFetch(a.url, { headers: { 'User-Agent': 'dsg-worker' } }, { fetch: fetchImpl, guard: opts.guard });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new Error(`larger than ${Math.round(maxBytes / 1048576)} MB, not hashed`);
        hash.update(chunk);
      }
      await db
        .update(releaseAssets)
        .set({ size, sha256: hash.digest('hex'), contentType: res.headers.get('content-type') })
        .where(eq(releaseAssets.id, a.id));
      updated++;
    } catch (e) {
      errors.push(`file ${a.url}: ${(e as Error).message}`);
      await setState(db, key, Date.now());
    }
  }
  return { updated, errors };
}

/**
 * Optional (RA_API_KEY): links dumps to RetroAchievements game ids by MD5, so frontends that
 * know a game by its RA id can find its mods. Console lists are cached for a week.
 */
export async function syncRetroAchievements(
  db: Db,
  reg: Registry,
  apiKey: string,
  opts: { fetch?: FetchLike } = {},
): Promise<{ updated: number; errors: string[] }> {
  const fetchImpl = opts.fetch ?? fetch;
  const errors: string[] = [];
  let updated = 0;
  for (const p of reg.catalog.platforms) {
    if (!p.retroachievements?.length) continue;
    const md5s = await db
      .select()
      .from(gameIdentifiers)
      .where(and(eq(gameIdentifiers.kind, 'md5'), or(eq(gameIdentifiers.platform, p.id), sql`${gameIdentifiers.platform} is null`)));
    if (!md5s.length) continue;
    for (const consoleId of p.retroachievements) {
      try {
        const key = `ra_hashes:${consoleId}`;
        let cached = await getState<{ at: number; byMd5: Record<string, number> }>(db, key);
        if (!cached || Date.now() - cached.at > 7 * RETRY_MS) {
          const url = new URL('https://retroachievements.org/API/API_GetGameList.php');
          url.searchParams.set('i', String(consoleId));
          url.searchParams.set('h', '1');
          url.searchParams.set('y', apiKey);
          const res = await fetchImpl(url, { headers: { 'User-Agent': 'dsg-worker' } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const list = (await res.json()) as { ID: number; Hashes?: string[] }[];
          const byMd5: Record<string, number> = {};
          for (const g of list) for (const h of g.Hashes ?? []) byMd5[h.toLowerCase()] = g.ID;
          cached = { at: Date.now(), byMd5 };
          await setState(db, key, cached);
        }
        for (const i of md5s) {
          const raId = cached.byMd5[i.value];
          if (!raId) continue;
          const res = await db
            .insert(gameIdentifiers)
            .values({
              gameId: i.gameId,
              kind: 'retroachievements',
              value: String(raId),
              platform: p.id,
              region: i.region,
              label: 'RetroAchievements',
              source: 'dat',
              siblingOf: i.source === 'manifest' ? `md5:${i.value}` : i.siblingOf,
            })
            .onConflictDoNothing()
            .returning({ id: gameIdentifiers.id });
          updated += res.length;
        }
      } catch (e) {
        errors.push(`retroachievements console ${consoleId}: ${(e as Error).message}`);
      }
    }
  }
  return { updated, errors };
}

/** Deletes screenshots nobody used within a week (abandoned forms). */
export async function cleanupUploads(db: Db, dir: string, olderThanMs = 7 * RETRY_MS): Promise<number> {
  const old = await db.select().from(uploads).where(lt(uploads.createdAt, new Date(Date.now() - olderThanMs)));
  if (!old.length) return 0;
  const used = new Set<string>();
  const shas = old.map((u) => u.sha256);
  const media = await db.select({ url: modMedia.url }).from(modMedia).where(eq(modMedia.source, 'upload'));
  for (const m of media) for (const s of shas) if (m.url.includes(s)) used.add(s);
  const subs = await db.select({ payload: submissions.payload }).from(submissions);
  for (const sub of subs) {
    const text = JSON.stringify(sub.payload);
    for (const s of shas) if (text.includes(s)) used.add(s);
  }
  const unused = shas.filter((s) => !used.has(s));
  for (const s of unused) {
    await rm(join(dir, `${s}.webp`), { force: true });
    await rm(join(dir, `${s}.thumb.webp`), { force: true });
  }
  if (unused.length) await db.delete(uploads).where(inArray(uploads.sha256, unused));
  return unused.length;
}
