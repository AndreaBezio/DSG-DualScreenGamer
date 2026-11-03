// Writes games and mods into the catalog. Shared by the registry sync (worker) and by
// approving community submissions (API), so both produce exactly the same rows.
import { and, eq, inArray, or } from 'drizzle-orm';
import type { DbOrTx } from './index.ts';
import { gameIdentifiers, games, modMedia, mods, modTargets, syncState, type Author, type ModSource } from './schema.ts';

export type Origin = { origin: 'registry' | 'community'; ownerUserId?: string | null };

export type GameInput = {
  id: string;
  title: string;
  platforms: string[];
  /** undefined = keep the id the worker resolved */
  igdbId?: number | null;
  /** Already normalized (see normalizeIdentifier) */
  identifiers: { kind: string; value: string; platform?: string | null; region?: string | null; label?: string | null }[];
};

export async function writeGame(tx: DbOrTx, g: GameInput, o: Origin): Promise<void> {
  const row = { id: g.id, title: g.title, platforms: g.platforms, origin: o.origin, ownerUserId: o.ownerUserId ?? null };
  const set = { ...row, ...(g.igdbId !== undefined ? { igdbId: g.igdbId } : {}), updatedAt: new Date() };
  await tx
    .insert(games)
    .values({ ...row, igdbId: g.igdbId ?? null })
    .onConflictDoUpdate({ target: games.id, set });
  const before = await tx
    .delete(gameIdentifiers)
    .where(and(eq(gameIdentifiers.gameId, g.id), eq(gameIdentifiers.source, 'manifest')))
    .returning({ kind: gameIdentifiers.kind, value: gameIdentifiers.value });
  // DAT rows are derived from the manifest ones: when those change, let syncArtwork rebuild them
  const key = (i: { kind: string; value: string }) => `${i.kind}:${i.value}`;
  const was = new Set(before.map(key));
  const now = new Set(g.identifiers.map(key));
  const changed = was.size !== now.size || [...now].some((k) => !was.has(k));
  const stale = new Set(changed ? [g.id] : []);
  if (g.identifiers.length) {
    // A manifest identifier replaces the same value found earlier through a DAT (on any game)
    const replaced = await tx
      .delete(gameIdentifiers)
      .where(
        and(
          eq(gameIdentifiers.source, 'dat'),
          or(...g.identifiers.map((i) => and(eq(gameIdentifiers.kind, i.kind), eq(gameIdentifiers.value, i.value)))),
        ),
      )
      .returning({ gameId: gameIdentifiers.gameId });
    for (const r of replaced) stale.add(r.gameId);
    await tx.insert(gameIdentifiers).values(
      g.identifiers.map((i) => ({
        gameId: g.id,
        kind: i.kind,
        value: i.value,
        platform: i.platform ?? null,
        region: i.region ?? null,
        label: i.label ?? null,
      })),
    );
  }
  if (stale.size) await tx.delete(syncState).where(inArray(syncState.key, [...stale].map((id) => `artwork_applied:${id}`)));
}

export type ModInput = {
  id: string;
  name: string;
  type: string;
  summary: string;
  description?: string | null;
  gameId?: string | null;
  authors: Author[];
  license: string;
  homepage?: string | null;
  tags: string[];
  requires: string[];
  devices: string[];
  source: ModSource;
  install: unknown[];
  targets: {
    platform: string;
    emulator?: string | null;
    minVersion?: string | null;
    maxVersion?: string | null;
    identifiers: { kind: string; value: string }[];
  }[];
};

export type MediaInput = {
  url: string;
  kind: 'gallery' | 'top' | 'bottom';
  pair: number | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  position: number;
};

/**
 * Upserts a mod with its targets and the media rows of one source (`manifest` for the
 * registry, `upload` for community screenshots). Media found automatically is untouched.
 */
export async function writeMod(
  tx: DbOrTx,
  m: ModInput,
  media: { source: 'manifest' | 'upload'; rows: MediaInput[] },
  o: Origin,
): Promise<void> {
  const row = {
    id: m.id,
    name: m.name,
    type: m.type,
    summary: m.summary,
    description: m.description ?? null,
    gameId: m.gameId ?? null,
    authors: m.authors,
    license: m.license,
    homepage: m.homepage ?? null,
    tags: m.tags,
    requires: m.requires,
    devices: m.devices,
    source: m.source,
    install: m.install,
    origin: o.origin,
    ownerUserId: o.ownerUserId ?? null,
  };
  await tx.insert(mods).values(row).onConflictDoUpdate({ target: mods.id, set: { ...row, updatedAt: new Date() } });
  await tx.delete(modMedia).where(and(eq(modMedia.modId, m.id), eq(modMedia.source, media.source)));
  if (media.rows.length) await tx.insert(modMedia).values(media.rows.map((r) => ({ ...r, source: media.source, modId: m.id })));
  await tx.delete(modTargets).where(eq(modTargets.modId, m.id));
  await tx.insert(modTargets).values(
    m.targets.map((t) => ({
      modId: m.id,
      platform: t.platform,
      emulator: t.emulator ?? null,
      minVersion: t.minVersion ?? null,
      maxVersion: t.maxVersion ?? null,
      identifiers: t.identifiers,
    })),
  );
}

/** Ids among `ids` that already belong to the other origin. */
export async function idsOwnedBy(tx: DbOrTx, table: 'mods' | 'games', ids: string[], origin: string): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const t = table === 'mods' ? mods : games;
  const rows = await tx.select({ id: t.id }).from(t).where(and(inArray(t.id, ids), eq(t.origin, origin)));
  return new Set(rows.map((r) => r.id));
}
