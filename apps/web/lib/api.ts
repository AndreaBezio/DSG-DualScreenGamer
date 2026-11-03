// Server-side client for the DSG API. Types mirror apps/api/src/dto.ts.

export type Identifier = {
  kind: string;
  value: string;
  platform: string | null;
  region: string | null;
  label: string | null;
  source: 'manifest' | 'dat';
};
export type GameMedia = { kind: 'cover' | 'screenshot' | 'title' | 'artwork'; url: string; width: number | null; height: number | null; source: string };
export type Game = {
  id: string;
  title: string;
  platforms: string[];
  igdb_id: number | null;
  summary: string | null;
  cover_url: string | null;
  hero_url: string | null;
  media: GameMedia[];
  release_year: number | null;
  identifiers: Identifier[];
  mod_count: number;
};
export type Asset = { role: string; name: string; url: string; size: number; sha256: string | null; content_type: string | null };
export type Release = {
  tag: string;
  version: string;
  name: string | null;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  changelog: string | null;
  assets: Asset[];
};
export type Media = { url: string; width: number | null; height: number | null; source: string; caption: string | null };
export type Preview = { top: Media; bottom: Media; caption: string | null };
export type InstallStep = { action: 'extract' | 'copy' | 'install_apk' | 'note'; asset?: string; to?: string; from?: string; text?: string };
export type Mod = {
  id: string;
  name: string;
  type: string;
  summary: string;
  description: string | null;
  game_id: string | null;
  authors: { name: string; github?: string }[];
  license: string;
  homepage: string | null;
  origin: 'registry' | 'community';
  source_repo: string | null;
  source_url: string | null;
  manual_download: boolean;
  tags: string[];
  cover_url: string | null;
  media: Media[];
  previews: Preview[];
  requires: string[];
  devices: string[];
  stars: number | null;
  targets: { platform: string; emulator: string | null; min_version: string | null; max_version: string | null }[];
  install: InstallStep[];
  latest_release: Release | null;
  compat: CompatSummary;
  updated_at: string;
};
export type Counts = { works: number; issues: number; broken: number };
export type CompatSummary = Counts & { by_device: Record<string, Counts> };
export type CompatReport = {
  id: number;
  version: string;
  device: string;
  firmware: string | null;
  emulator: string | null;
  emulator_version: string | null;
  result: 'works' | 'issues' | 'broken';
  note: string | null;
  user: { display_name: string; avatar_url: string | null };
  updated_at: string;
};
export type Platform = { id: string; name: string; manufacturer: string | null; kind: string; screens: number };
export type Submission = {
  id: string;
  status: 'draft' | 'pending' | 'changes_requested' | 'approved' | 'rejected';
  mod_id: string | null;
  name: string | null;
  type: string | null;
  game: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
};
export type Emulator = { id: string; name: string; kind: string; platforms: string[]; homepage: string | null };
export type Device = { id: string; name: string; manufacturer: string; screens: number };
export type Index = { platforms: Platform[]; emulators: Emulator[]; devices: Device[]; games: Game[]; mods: Mod[] };

const BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
export const PUBLIC_API_URL = process.env.PUBLIC_API_URL ?? 'http://localhost:3001';

async function get<T>(path: string): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': 'dsg-web' },
    next: { revalidate: 60 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  index: async () => (await get<Index>('/v1/index.json'))!,
  game: (id: string) => get<Game>(`/v1/games/${encodeURIComponent(id)}`),
  mod: (id: string) => get<Mod>(`/v1/mods/${encodeURIComponent(id)}`),
  modsForGame: async (id: string) => (await get<{ items: Mod[] }>(`/v1/mods?game=${encodeURIComponent(id)}`))?.items ?? [],
  mods: async (params: Record<string, string | undefined>) =>
    (await get<{ items: Mod[] }>(`/v1/mods?${query(params)}`))?.items ?? [],
  games: async (params: Record<string, string | undefined>) =>
    (await get<{ items: Game[]; next_offset: number | null }>(`/v1/games?${query({ limit: '100', ...params })}`))?.items ?? [],
  reports: async (id: string) =>
    (await get<{ summary: CompatSummary; items: CompatReport[] }>(`/v1/mods/${encodeURIComponent(id)}/reports`)) ?? null,
  releases: async (id: string) => (await get<{ items: Release[] }>(`/v1/mods/${encodeURIComponent(id)}/releases`))?.items ?? [],
};

function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return q.toString();
}

export const MOD_TYPES = ['dual_screen_layout', 'port', 'texture_pack', 'patch', 'companion_app', 'shader', 'utility'] as const;
export type ModType = (typeof MOD_TYPES)[number];

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
