import { createHash } from 'node:crypto';
import type { Platform } from '@dsg/schema';
import { normalizeIdentifier, type GameManifest, type IdentifierKind } from '@dsg/schema';
import type { FetchLike } from './github.ts';

/** One game of a clrmamepro-format DAT (libretro-database metadat/no-intro|redump). */
export type DatGame = {
  name: string;
  region?: string;
  serial?: string;
  roms: { name?: string; crc?: string; md5?: string; sha1?: string; serial?: string }[];
};

type Node = string | Node[];

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|([()])|([^\s()"]+)/g;
  for (const m of text.matchAll(re)) {
    // Quoted strings keep a marker so `(` inside a name is not a paren
    if (m[1] !== undefined) tokens.push(`"${m[1]}`);
    else tokens.push(m[2] ?? m[3]!);
  }
  return tokens;
}

function parseList(tokens: string[], i: number): [Node[], number] {
  const out: Node[] = [];
  while (i < tokens.length) {
    const t = tokens[i++]!;
    if (t === '(') {
      const [child, next] = parseList(tokens, i);
      out.push(child);
      i = next;
    } else if (t === ')') return [out, i];
    else out.push(t.startsWith('"') ? t.slice(1) : t);
  }
  return [out, i];
}

/** key value key value… -> record; repeated keys (rom) collected in arrays. */
function pairs(list: Node[]): Map<string, Node[]> {
  const map = new Map<string, Node[]>();
  for (let i = 0; i + 1 < list.length; i += 2) {
    const k = list[i];
    if (typeof k !== 'string') continue;
    map.set(k, [...(map.get(k) ?? []), list[i + 1]!]);
  }
  return map;
}

const str = (n: Node | undefined) => (typeof n === 'string' ? n : undefined);

export function parseDat(text: string): DatGame[] {
  const [root] = parseList(tokenize(text), 0);
  const games: DatGame[] = [];
  const top = pairs(root);
  for (const g of top.get('game') ?? []) {
    if (!Array.isArray(g)) continue;
    const f = pairs(g);
    const name = str(f.get('name')?.[0]);
    if (!name) continue;
    games.push({
      name,
      region: str(f.get('region')?.[0]),
      serial: str(f.get('serial')?.[0]),
      roms: (f.get('rom') ?? []).filter(Array.isArray).map((r) => {
        const rf = pairs(r as Node[]);
        return {
          name: str(rf.get('name')?.[0]),
          crc: str(rf.get('crc')?.[0])?.toLowerCase(),
          md5: str(rf.get('md5')?.[0])?.toLowerCase(),
          sha1: str(rf.get('sha1')?.[0])?.toLowerCase(),
          serial: str(rf.get('serial')?.[0]),
        };
      }),
    });
  }
  return games;
}

/** Index by `kind:value` using DSG's normalized identifiers. */
export function indexDat(games: DatGame[]): Map<string, DatGame> {
  const idx = new Map<string, DatGame>();
  const add = (kind: IdentifierKind, value: string | undefined, g: DatGame) => {
    if (value) idx.set(`${kind}:${normalizeIdentifier(kind, value)}`, g);
  };
  for (const g of games) {
    add('serial', g.serial, g);
    for (const r of g.roms) {
      add('sha1', r.sha1, g);
      add('md5', r.md5, g);
      add('crc32', r.crc, g);
      add('serial', r.serial, g);
    }
  }
  return idx;
}

/** Identifiers a DAT entry adds: all hashes of its first ROM, plus its serial. */
export function datIdentifiers(g: DatGame): { kind: IdentifierKind; value: string; region: string | null }[] {
  const out: { kind: IdentifierKind; value: string; region: string | null }[] = [];
  const rom = g.roms[0];
  const region = g.region ?? null;
  if (rom?.sha1) out.push({ kind: 'sha1', value: rom.sha1, region });
  if (rom?.md5) out.push({ kind: 'md5', value: rom.md5, region });
  if (rom?.crc) out.push({ kind: 'crc32', value: rom.crc, region });
  const serial = g.serial ?? rom?.serial;
  if (serial) out.push({ kind: 'serial', value: normalizeIdentifier('serial', serial), region });
  return out;
}

export function datUrl(p: NonNullable<Platform['libretro']>): string {
  return `https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/${p.dat}/${encodeURIComponent(p.system)}.dat`;
}

/** libretro-thumbnails replaces these characters in file names. */
export function thumbnailFileName(name: string): string {
  return name.replace(/[&*/:`<>?\\|"]/g, '_');
}

export const THUMB_KINDS = { Named_Boxarts: 'cover', Named_Snaps: 'screenshot', Named_Titles: 'title' } as const;

export function thumbnailUrl(system: string, folder: keyof typeof THUMB_KINDS, name: string): string {
  const repo = system.replace(/ /g, '_');
  return `https://raw.githubusercontent.com/libretro-thumbnails/${repo}/master/${folder}/${encodeURIComponent(thumbnailFileName(name))}.png`;
}

/** First DAT entry matching any of the game's identifiers (hashes before serials). */
export function matchGame(game: Pick<GameManifest, 'identifiers'>, idx: Map<string, DatGame>, platform: string): DatGame | null {
  for (const kind of MATCH_ORDER) {
    for (const i of game.identifiers) {
      if (i.kind !== kind || (i.platform && i.platform !== platform)) continue;
      const hit = idx.get(`${kind}:${normalizeIdentifier(kind, i.value)}`);
      if (hit) return hit;
    }
  }
  return null;
}

export type ArtworkMatch = {
  datName: string;
  identifiers: { kind: IdentifierKind; value: string; region: string | null; platform: string; label: string; siblingOf: string }[];
  media: { kind: string; url: string }[];
};

const MATCH_ORDER: IdentifierKind[] = ['sha1', 'md5', 'crc32', 'serial'];

/** Looks up one game in a platform's DAT and checks which thumbnails exist. */
export async function libretroArtwork(
  game: GameManifest,
  platform: Platform,
  idx: Map<string, DatGame>,
  exists: (url: string) => Promise<boolean>,
): Promise<ArtworkMatch | null> {
  if (!platform.libretro) return null;
  const hit = matchGame(game, idx, platform.id);
  if (!hit) return null;
  // Every dump the manifest lists (USA, EUR…) brings its own sibling hashes/serial
  const identifiers: ArtworkMatch['identifiers'] = [];
  const seen = new Set<DatGame>();
  for (const kind of MATCH_ORDER) {
    for (const i of game.identifiers) {
      if (i.kind !== kind || (i.platform && i.platform !== platform.id)) continue;
      const value = normalizeIdentifier(kind, i.value);
      const entry = idx.get(`${kind}:${value}`);
      if (!entry || seen.has(entry)) continue;
      seen.add(entry);
      for (const d of datIdentifiers(entry)) {
        identifiers.push({ ...d, platform: platform.id, label: entry.name, siblingOf: `${kind}:${value}` });
      }
    }
  }
  const media: ArtworkMatch['media'] = [];
  for (const [folder, kind] of Object.entries(THUMB_KINDS) as [keyof typeof THUMB_KINDS, string][]) {
    const url = thumbnailUrl(platform.libretro.system, folder, hit.name);
    if (await exists(url).catch(() => false)) media.push({ kind, url });
  }
  return { datName: hit.name, identifiers, media };
}

export async function fetchDat(fetchImpl: FetchLike, p: NonNullable<Platform['libretro']>): Promise<DatGame[]> {
  const res = await fetchImpl(datUrl(p), { headers: { 'User-Agent': 'dsg-worker' } });
  if (!res.ok) throw new Error(`libretro DAT ${p.system}: HTTP ${res.status}`);
  return parseDat(await res.text());
}

export async function urlExists(fetchImpl: FetchLike, url: string): Promise<boolean> {
  const res = await fetchImpl(url, { method: 'HEAD', headers: { 'User-Agent': 'dsg-worker' } });
  return res.ok;
}

/** Changes when the inputs of a game's artwork lookup change. */
export function artworkSignature(game: GameManifest, platform: Platform): string {
  return createHash('sha1').update(JSON.stringify([game.identifiers, game.platforms, platform.libretro])).digest('hex');
}

/** Normalized title for comparing names across databases. */
export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}
