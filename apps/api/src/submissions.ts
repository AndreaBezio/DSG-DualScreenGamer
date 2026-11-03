// Community submissions: validation against the catalog, and publishing on approval.
import {
  devices,
  emulators,
  gameIdentifiers,
  games,
  modReleases,
  mods,
  platforms,
  releaseAssets,
  submissions,
  syncState,
  uploads,
  writeGame,
  writeMod,
  type Db,
  type MediaInput,
  type ModSource,
} from '@dsg/db';
import { CommunitySubmission, normalizeIdentifier } from '@dsg/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { User } from './auth.ts';
import { isModerator } from './auth.ts';
import { mediaUrl } from './uploads.ts';

export type Submission = typeof submissions.$inferSelect;
type Valid = { ok: true; data: CommunitySubmission } | { ok: false; errors: string[] };

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'mod'
  );
}

async function uniqueId(db: Db, table: typeof mods | typeof games, base: string): Promise<string> {
  const taken = new Set((await db.select({ id: table.id }).from(table)).map((r) => r.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Schema check plus everything the schema can't know: uploads, catalog ids, identifier owners. */
export async function validateSubmission(db: Db, payload: unknown, user: User, editingModId?: string | null): Promise<Valid> {
  const parsed = CommunitySubmission.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'submission'}: ${i.message}`) };
  }
  const s = parsed.data;
  const errors: string[] = [];

  const refs = [...new Set([...s.screens.pairs.flatMap((p) => [p.top, p.bottom]), ...s.screens.gallery, ...(s.screens.cover ? [s.screens.cover] : [])])];
  const found = await db.select().from(uploads).where(inArray(uploads.sha256, refs));
  for (const r of refs) {
    const u = found.find((f) => f.sha256 === r);
    if (!u) errors.push(`screens: image ${r.slice(0, 8)}… was not uploaded`);
    // Screenshots already on the mod being edited may come from another uploader (e.g. a moderator)
    else if (u.userId !== user.id && !isModerator(user) && !editingModId) errors.push(`screens: image ${r.slice(0, 8)}… belongs to another user`);
  }
  const all = new Set([...s.screens.pairs.flatMap((p) => [p.top, p.bottom]), ...s.screens.gallery]);
  if (s.screens.cover && !all.has(s.screens.cover)) errors.push('screens.cover: must be one of the uploaded images');

  const [plats, emus, devs] = await Promise.all([db.select().from(platforms), db.select().from(emulators), db.select().from(devices)]);
  let gamePlatforms: string[] = [];
  let gameIds: { kind: string; value: string }[] = [];
  if ('existing' in s.game) {
    const [g] = await db.select().from(games).where(eq(games.id, s.game.existing));
    if (!g) errors.push(`game: unknown game "${s.game.existing}"`);
    else {
      gamePlatforms = g.platforms;
      gameIds = await db.select({ kind: gameIdentifiers.kind, value: gameIdentifiers.value }).from(gameIdentifiers).where(eq(gameIdentifiers.gameId, g.id));
    }
  } else {
    gamePlatforms = s.game.new.platforms;
    for (const p of gamePlatforms) if (!plats.some((x) => x.id === p)) errors.push(`game.platforms: unknown platform "${p}"`);
    gameIds = s.game.new.identifiers.map((i) => ({ kind: i.kind, value: normalizeIdentifier(i.kind, i.value) }));
    for (const i of gameIds) {
      const [owner] = await db
        .select({ gameId: gameIdentifiers.gameId })
        .from(gameIdentifiers)
        .where(and(eq(gameIdentifiers.kind, i.kind), eq(gameIdentifiers.value, i.value)));
      if (owner) errors.push(`game.identifiers: ${i.kind} ${i.value} already belongs to "${owner.gameId}" — pick that game instead`);
    }
  }

  for (const [n, t] of s.targets.entries()) {
    if (!plats.some((p) => p.id === t.platform)) errors.push(`targets.${n}.platform: unknown platform "${t.platform}"`);
    else if (gamePlatforms.length && !gamePlatforms.includes(t.platform)) errors.push(`targets.${n}.platform: the game is not on ${t.platform}`);
    if (t.emulator) {
      const e = emus.find((x) => x.id === t.emulator);
      if (!e) errors.push(`targets.${n}.emulator: unknown emulator "${t.emulator}"`);
      else if (!e.platforms.includes(t.platform)) errors.push(`targets.${n}.emulator: ${e.name} does not run ${t.platform}`);
    }
    for (const i of t.identifiers) {
      const v = normalizeIdentifier(i.kind, i.value);
      if (!gameIds.some((g) => g.kind === i.kind && g.value === v)) errors.push(`targets.${n}.identifiers: ${i.kind} ${i.value} is not a dump of this game`);
    }
  }
  for (const d of s.mod.devices) if (!devs.some((x) => x.id === d)) errors.push(`mod.devices: unknown device "${d}"`);

  if (editingModId) {
    const [m] = await db.select().from(mods).where(eq(mods.id, editingModId));
    if (!m) errors.push('this mod no longer exists');
    else if (m.origin !== 'community') errors.push('this mod is maintained in the GitHub registry: edit its manifest instead');
    else if (m.ownerUserId !== user.id && !isModerator(user)) errors.push('only the owner can edit this mod');
  }
  return errors.length ? { ok: false, errors } : { ok: true, data: s };
}

/** Orders screenshots so the chosen cover gets the lowest position. */
export function mediaRows(s: CommunitySubmission, dims: Map<string, { width: number; height: number }>, publicUrl: string): MediaInput[] {
  const pairs = [...s.screens.pairs];
  const coverPair = pairs.findIndex((p) => p.top === s.screens.cover || p.bottom === s.screens.cover);
  if (coverPair > 0) pairs.unshift(...pairs.splice(coverPair, 1));
  const gallery = [...s.screens.gallery];
  const galleryFirst = !!s.screens.cover && gallery.includes(s.screens.cover);
  if (galleryFirst) gallery.unshift(...gallery.splice(gallery.indexOf(s.screens.cover!), 1));

  const rows: MediaInput[] = [];
  const img = (sha: string) => ({ url: mediaUrl(publicUrl, sha), width: dims.get(sha)?.width ?? null, height: dims.get(sha)?.height ?? null });
  const pushGallery = () => gallery.forEach((g) => rows.push({ ...img(g), kind: 'gallery', pair: null, caption: null, position: rows.length }));
  if (galleryFirst) pushGallery();
  pairs.forEach((p, i) => {
    rows.push({ ...img(p.top), kind: 'top', pair: i, caption: p.caption ?? null, position: rows.length });
    rows.push({ ...img(p.bottom), kind: 'bottom', pair: i, caption: p.caption ?? null, position: rows.length });
  });
  if (!galleryFirst) pushGallery();
  return rows;
}

/** Writes an approved submission into the catalog. Returns the mod id. */
export async function publishSubmission(db: Db, sub: Submission, s: CommunitySubmission, publicUrl: string): Promise<string> {
  const refs = [...s.screens.pairs.flatMap((p) => [p.top, p.bottom]), ...s.screens.gallery];
  const dims = new Map(
    (await db.select().from(uploads).where(inArray(uploads.sha256, refs))).map((u) => [u.sha256, { width: u.width, height: u.height }]),
  );
  const gameId = 'existing' in s.game ? s.game.existing : await uniqueId(db, games, slugify(s.game.new.title));
  const modId = sub.modId ?? (await uniqueId(db, mods, slugify(s.mod.name)));
  const owner = { origin: 'community' as const, ownerUserId: sub.userId };

  const source: ModSource =
    s.download.kind === 'github'
      ? { github: s.download.github, assets: s.download.assets, prereleases: s.download.prereleases, auto_media: true }
      : { manual: true, ...(s.download.page_url ? { page_url: s.download.page_url } : {}) };

  await db.transaction(async (tx) => {
    if ('new' in s.game) {
      await writeGame(
        tx,
        {
          id: gameId,
          title: s.game.new.title,
          platforms: s.game.new.platforms,
          identifiers: s.game.new.identifiers.map((i) => ({ ...i, value: normalizeIdentifier(i.kind, i.value) })),
        },
        owner,
      );
    }
    await writeMod(
      tx,
      {
        id: modId,
        name: s.mod.name,
        type: s.mod.type,
        summary: s.mod.summary,
        description: s.mod.description,
        gameId,
        authors: s.mod.authors,
        license: s.mod.license,
        homepage: s.mod.homepage,
        tags: s.mod.tags,
        requires: s.mod.requires,
        devices: s.mod.devices,
        source,
        install: s.install,
        targets: s.targets.map((t) => ({
          platform: t.platform,
          emulator: t.emulator,
          minVersion: t.min_version,
          maxVersion: t.max_version,
          identifiers: t.identifiers.map((i) => ({ kind: i.kind, value: normalizeIdentifier(i.kind, i.value) })),
        })),
      },
      { source: 'upload', rows: mediaRows(s, dims, publicUrl) },
      owner,
    );
    await tx.update(mods).set({ published: true }).where(eq(mods.id, modId));

    if (s.download.kind === 'manual') {
      // A manual release is replaced as a whole; the worker fills in sizes and sha256
      await tx.delete(modReleases).where(eq(modReleases.modId, modId));
      const d = s.download;
      const publishedAt = d.released_at ? new Date(`${d.released_at}T00:00:00Z`) : new Date();
      const [rel] = await tx
        .insert(modReleases)
        .values({
          modId,
          tag: d.version,
          version: d.version,
          name: d.version,
          prerelease: false,
          publishedAt,
          changelog: d.changelog ?? null,
          htmlUrl: d.page_url ?? s.mod.homepage ?? d.files[0]?.url ?? '',
        })
        .returning({ id: modReleases.id });
      if (d.files.length) {
        await tx.insert(releaseAssets).values(
          d.files.map((f) => ({ releaseId: rel!.id, role: f.role, name: f.label, url: f.url, size: 0, sha256: null, contentType: null })),
        );
      }
      await tx.update(mods).set({ lastReleaseAt: publishedAt }).where(eq(mods.id, modId));
    } else {
      // Ask the worker to fetch the GitHub releases now instead of at the next scheduled run
      const value = { v: Date.now() };
      await tx.insert(syncState).values({ key: 'sync_requested_at', value }).onConflictDoUpdate({ target: syncState.key, set: { value } });
    }
  });
  return modId;
}
