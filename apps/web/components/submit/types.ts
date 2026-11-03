// Shape of a submission draft in the form; mirrors CommunitySubmission in packages/schema.

export type Ident = { kind: string; value: string; platform?: string; region?: string };
export type TargetDraft = {
  platform: string;
  emulator?: string;
  min_version?: string;
  max_version?: string;
  identifiers: { kind: string; value: string }[];
};
export type PairDraft = { top?: string; bottom?: string; caption?: string };
export type FileDraft = { label: string; role: string; url: string };
export type StepDraft = { action: 'extract' | 'copy' | 'install_apk' | 'note'; asset?: string; to?: string; text?: string };

export type Draft = {
  game: { existing: string } | { new: { title: string; platforms: string[]; identifiers: Ident[] } };
  mod: {
    name: string;
    type: string;
    summary: string;
    description?: string;
    tags: string[];
    license: string;
    authors: { name: string; github?: string }[];
    homepage?: string;
    requires: string[];
    devices: string[];
  };
  targets: TargetDraft[];
  screens: { pairs: PairDraft[]; gallery: string[]; cover?: string };
  download:
    | { kind: 'github'; github: string; assets: { role: string; pattern: string }[]; prereleases: boolean }
    | { kind: 'manual'; version: string; released_at?: string; changelog?: string; files: FileDraft[]; page_url?: string };
  install: StepDraft[];
  consent: { rights: boolean; no_game_files: boolean };
};

export const MOD_TYPES = ['dual_screen_layout', 'port', 'texture_pack', 'patch', 'companion_app', 'shader', 'utility'] as const;
export const LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-3-Clause',
  'MPL-2.0',
  'GPL-2.0',
  'GPL-3.0',
  'LGPL-3.0',
  'Unlicense',
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0',
  'All rights reserved',
  'unknown',
] as const;
export const ROLES = ['main', 'companion_apk', 'optional', 'source'] as const;
export const PATH_VARS = [
  '{emulator.data_dir}',
  '{emulator.load_dir}',
  '{emulator.textures_dir}',
  '{emulator.mods_dir}',
  '{emulator.layouts_dir}',
  '{game.dir}',
  '{game.mods_dir}',
  '{game.title_id}',
  '{game.serial}',
] as const;
export const ID_KINDS = ['sha1', 'md5', 'crc32', 'title_id', 'serial', 'steam_appid', 'gog_id', 'android_pkg'] as const;

export function emptyDraft(me: { display_name: string }): Draft {
  return {
    game: { new: { title: '', platforms: [], identifiers: [] } },
    mod: { name: '', type: 'dual_screen_layout', summary: '', tags: [], license: 'unknown', authors: [{ name: me.display_name }], requires: [], devices: ['ayn-thor'] },
    targets: [],
    screens: { pairs: [{}], gallery: [] },
    download: { kind: 'manual', version: '1.0', files: [{ label: '', role: 'main', url: '' }] },
    install: [],
    consent: { rights: false, no_game_files: false },
  };
}

/** Fills in what an older or partial draft lacks, so the form can render any saved payload. */
export function withDefaults(raw: unknown, me: { display_name: string }): Draft {
  const d = emptyDraft(me);
  const r = (raw ?? {}) as Partial<Draft>;
  return {
    game: r.game ?? d.game,
    mod: { ...d.mod, ...r.mod },
    targets: r.targets ?? d.targets,
    screens: { ...d.screens, ...r.screens, pairs: r.screens?.pairs?.length ? r.screens.pairs : d.screens.pairs },
    download: r.download ?? d.download,
    install: r.install ?? d.install,
    consent: { ...d.consent, ...r.consent },
  };
}

/** Drops empty strings and half-filled rows so optional fields don't fail validation. */
export function clean(d: Draft): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        const s = strip(x);
        if (s !== '' && s !== undefined) out[k] = s;
      }
      return out;
    }
    return typeof v === 'string' ? v.trim() : v;
  };
  const c = strip(d) as Draft;
  c.screens.pairs = c.screens.pairs.filter((p) => p.top || p.bottom);
  c.mod.tags = c.mod.tags.filter(Boolean);
  c.mod.requires = c.mod.requires.filter(Boolean);
  if (c.download.kind === 'manual') c.download.files = c.download.files.filter((f) => f.url || f.label);
  if ('new' in c.game) c.game.new.identifiers = c.game.new.identifiers.filter((i) => i.value);
  return c;
}

/** "Legend of Zelda, The - The Minish Cap (USA)" -> "Legend of Zelda, The - The Minish Cap" */
export function titleFromDatName(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').trim();
}

export function regionFromDat(region: string | null | undefined): string | undefined {
  if (!region) return undefined;
  const r = region.toLowerCase();
  if (r.startsWith('usa')) return 'USA';
  if (r.startsWith('europe')) return 'EUR';
  if (r.startsWith('japan')) return 'JPN';
  return region;
}
