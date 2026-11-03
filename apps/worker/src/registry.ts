import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import {
  Catalog,
  Device,
  Emulator,
  GameManifest,
  ModManifest,
  normalizeIdentifier,
  Platform,
} from '@dsg/schema';
import { parse } from 'yaml';
import { z } from 'zod';

export type Registry = {
  catalog: Catalog;
  games: GameManifest[];
  mods: ModManifest[];
};

export type LoadResult = { registry: Registry; errors: string[] };

function readYaml(file: string): unknown {
  return parse(readFileSync(file, 'utf8'));
}

function yamlFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function formatIssues(file: string, error: z.ZodError): string[] {
  return error.issues.map((i) => `${file}: ${i.path.join('.') || '(root)'}: ${i.message}`);
}

/** Parses every manifest and cross-checks references. Never throws on bad content: errors are collected. */
export function loadRegistry(root: string): LoadResult {
  const errors: string[] = [];
  const rel = (f: string) => relative(root, f);

  function parseList<T>(file: string, schema: z.ZodType<T>): T[] {
    const res = z.array(schema).safeParse(readYaml(file));
    if (!res.success) {
      errors.push(...formatIssues(rel(file), res.error));
      return [];
    }
    return res.data;
  }

  const catalog: Catalog = {
    platforms: parseList(join(root, 'catalog/platforms.yaml'), Platform),
    emulators: parseList(join(root, 'catalog/emulators.yaml'), Emulator),
    devices: parseList(join(root, 'catalog/devices.yaml'), Device),
  };

  function parseDir<T extends { id: string }>(dir: string, schema: z.ZodType<T>): T[] {
    const out: T[] = [];
    for (const file of yamlFiles(join(root, dir))) {
      let raw: unknown;
      try {
        raw = readYaml(file);
      } catch (e) {
        errors.push(`${rel(file)}: invalid YAML: ${(e as Error).message}`);
        continue;
      }
      const res = schema.safeParse(raw);
      if (!res.success) {
        errors.push(...formatIssues(rel(file), res.error));
        continue;
      }
      if (basename(file).replace(/\.ya?ml$/, '') !== res.data.id) {
        errors.push(`${rel(file)}: file name must match id "${res.data.id}"`);
      }
      out.push(res.data);
    }
    return out;
  }

  const games = parseDir('games', GameManifest);
  const mods = parseDir('mods', ModManifest);

  // Cross-reference checks
  const platformIds = new Set(catalog.platforms.map((p) => p.id));
  const emulatorById = new Map(catalog.emulators.map((e) => [e.id, e]));
  const deviceIds = new Set(catalog.devices.map((d) => d.id));
  const gameById = new Map(games.map((g) => [g.id, g]));

  const dupes = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`duplicate ${what} id "${id}"`);
      seen.add(id);
    }
  };
  dupes(catalog.platforms.map((p) => p.id), 'platform');
  dupes(catalog.emulators.map((e) => e.id), 'emulator');
  dupes(catalog.devices.map((d) => d.id), 'device');
  dupes(games.map((g) => g.id), 'game');
  dupes(mods.map((m) => m.id), 'mod');

  // Every name a client may send as `platform=` must point to exactly one platform
  const platformNames = new Map<string, string>();
  for (const p of catalog.platforms) {
    for (const n of [p.id, ...p.aliases]) {
      const owner = platformNames.get(n);
      if (owner && owner !== p.id) errors.push(`platform ${p.id}: alias "${n}" already names platform ${owner}`);
      platformNames.set(n, p.id);
    }
  }

  for (const e of catalog.emulators) {
    for (const p of e.platforms) if (!platformIds.has(p)) errors.push(`emulator ${e.id}: unknown platform "${p}"`);
  }

  const identifierOwner = new Map<string, string>();
  for (const g of games) {
    for (const p of g.platforms) if (!platformIds.has(p)) errors.push(`game ${g.id}: unknown platform "${p}"`);
    for (const i of g.identifiers) {
      const key = `${i.kind}:${normalizeIdentifier(i.kind, i.value)}`;
      const owner = identifierOwner.get(key);
      if (owner) errors.push(`game ${g.id}: identifier ${key} already belongs to game ${owner}`);
      identifierOwner.set(key, g.id);
      if (i.platform && !platformIds.has(i.platform)) errors.push(`game ${g.id}: identifier ${key} has unknown platform "${i.platform}"`);
    }
  }

  for (const m of mods) {
    const game = m.game ? gameById.get(m.game) : undefined;
    if (m.game && !game) errors.push(`mod ${m.id}: unknown game "${m.game}" (add registry/games/${m.game}.yaml)`);
    for (const d of m.devices) if (!deviceIds.has(d)) errors.push(`mod ${m.id}: unknown device "${d}"`);
    for (const t of m.targets) {
      if (!platformIds.has(t.platform)) errors.push(`mod ${m.id}: unknown target platform "${t.platform}"`);
      if (t.emulator) {
        const emu = emulatorById.get(t.emulator);
        if (!emu) errors.push(`mod ${m.id}: unknown emulator "${t.emulator}"`);
        else if (!emu.platforms.includes(t.platform))
          errors.push(`mod ${m.id}: emulator ${t.emulator} does not support platform ${t.platform}`);
      }
      for (const i of t.identifiers) {
        const owner = identifierOwner.get(`${i.kind}:${normalizeIdentifier(i.kind, i.value)}`);
        if (owner !== m.game) errors.push(`mod ${m.id}: target identifier ${i.kind}:${i.value} is not listed in game ${m.game}`);
      }
    }
  }

  return { registry: { catalog, games, mods }, errors };
}
