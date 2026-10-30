import { posix } from 'node:path';
import type { ModManifest } from '@dsg/schema';
import { imageSize } from 'image-size';
import type { GhAsset } from './github.ts';

export type MediaSource = 'manifest' | 'release' | 'readme' | 'asset';
export type Candidate = { url: string; source: MediaSource; alt?: string };
export type MediaRow = {
  url: string;
  source: MediaSource;
  kind: 'gallery' | 'top' | 'bottom';
  pair: number | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  position: number;
};

const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;
const MAX_AUTO = 12;
const MIN_WIDTH = 240;
const MIN_HEIGHT = 120;

/** Raw URL of a file in a repo; HEAD follows the default branch. */
export function rawUrl(repo: string, path: string, ref = 'HEAD'): string {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${path.replace(/^\.?\//, '')}`;
}

/** Resolves a manifest MediaRef (URL or repo path) to a URL. */
export function resolveManifestRef(repo: string, ref: string): string {
  return /^https?:\/\//.test(ref) ? ref : rawUrl(repo, ref);
}

/** Images referenced by markdown or HTML: ![alt](url), <img src>, and bare user-attachment links. */
export function extractImages(text: string): { url: string; alt?: string }[] {
  const out: { url: string; alt?: string }[] = [];
  for (const m of text.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) out.push({ url: m[2]!, alt: m[1] || undefined });
  for (const m of text.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const alt = m[0].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1];
    out.push({ url: m[1]!, alt: alt || undefined });
  }
  // GitHub turns a pasted image into a lone https://github.com/user-attachments/assets/<id> line
  for (const m of text.matchAll(/^\s*(https:\/\/github\.com\/user-attachments\/assets\/[\w-]+)\s*$/gm)) out.push({ url: m[1]! });
  return out;
}

/**
 * Makes a README/release-notes image URL absolute and directly loadable.
 * `base` is the raw URL of the document the reference appears in.
 */
export function resolveImageUrl(url: string, base: string | null): string | null {
  const u = url.trim();
  if (!u || u.startsWith('#') || u.startsWith('data:') || u.startsWith('mailto:')) return null;
  // github.com/<o>/<r>/blob/<ref>/<path> pages -> raw files
  const blob = u.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/(.+?)(\?.*)?$/);
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}`;
  if (/^https?:\/\//.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (!base) return null;
  const b = new URL(base);
  const dir = posix.dirname(b.pathname);
  // Leading slash in a README means "repo root": keep the /<owner>/<repo>/<ref> prefix
  const [, owner, repo, ref] = b.pathname.split('/');
  const path = u.startsWith('/') ? posix.join('/', owner!, repo!, ref!, u) : posix.join(dir, u);
  return `${b.origin}${path}`;
}

const BADGE_HOSTS = ['img.shields.io', 'shields.io', 'badgen.net', 'badge.fury.io', 'codecov.io', 'travis-ci.org', 'travis-ci.com', 'ko-fi.com', 'www.buymeacoffee.com', 'buymeacoffee.com', 'img.buymeacoffee.com', 'storage.ko-fi.com', 'api.star-history.com', 'contrib.rocks', 'komarev.com', 'visitor-badge.laobi.icu'];

export function isUnwantedImage(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (BADGE_HOSTS.includes(u.hostname)) return true;
  if (/\/badge(\.svg)?$|\/badges?\//i.test(u.pathname)) return true;
  if (/\.svg$/i.test(u.pathname)) return true;
  // Only keep URLs that look like images, or GitHub's extensionless attachments
  return !(IMAGE_RE.test(u.pathname) || u.hostname === 'github.com' && u.pathname.startsWith('/user-attachments/'));
}

const TOP_RE = /^(.*?)[-_. ]?(top|upper|main|screen1|primary)$/;
const BOTTOM_RE = /^(.*?)[-_. ]?(bottom|lower|second|secondary|sub|screen2)$/;

function stem(url: string): string {
  return posix.basename(new URL(url).pathname).replace(/\.[^.]+$/, '').toLowerCase();
}

/** Pairs images named like `map-top.png` / `map-bottom.png`. Order follows the top image. */
export function pairByName<T extends { url: string }>(items: T[]): { pairs: [T, T][]; rest: T[] } {
  const pairs: [T, T][] = [];
  const used = new Set<T>();
  for (const top of items) {
    const t = stem(top.url).match(TOP_RE);
    if (!t) continue;
    const bottom = items.find((b) => {
      if (used.has(b) || b === top) return false;
      const m = stem(b.url).match(BOTTOM_RE);
      return m && m[1] === t[1];
    });
    if (bottom) {
      pairs.push([top, bottom]);
      used.add(top).add(bottom);
    }
  }
  return { pairs, rest: items.filter((i) => !used.has(i)) };
}

export function readSize(head: Uint8Array | null): { width: number; height: number } | null {
  if (!head) return null;
  try {
    const { width, height } = imageSize(head);
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

/** Rows that come straight from the manifest: previews first, then screenshots. */
export function manifestMedia(mod: Pick<ModManifest, 'previews' | 'screenshots' | 'source'>): MediaRow[] {
  const repo = mod.source.github;
  const rows: MediaRow[] = [];
  mod.previews.forEach((p, pair) => {
    for (const kind of ['top', 'bottom'] as const) {
      rows.push({ url: resolveManifestRef(repo, p[kind]), source: 'manifest', kind, pair, caption: p.caption ?? null, width: null, height: null, position: rows.length });
    }
  });
  for (const s of mod.screenshots) {
    rows.push({ url: resolveManifestRef(repo, s), source: 'manifest', kind: 'gallery', pair: null, caption: null, width: null, height: null, position: rows.length });
  }
  return rows;
}

/** Candidate images found automatically, in priority order, deduplicated and filtered. */
export function autoCandidates(input: {
  releaseNotes: string | null;
  releaseNotesBase: string | null;
  readme: { url: string; alt?: string }[];
  assets: Pick<GhAsset, 'name' | 'browser_download_url'>[];
  exclude: string[];
}): Candidate[] {
  const seen = new Set(input.exclude);
  const out: Candidate[] = [];
  const add = (url: string | null, source: MediaSource, alt?: string) => {
    if (!url || seen.has(url) || isUnwantedImage(url)) return;
    seen.add(url);
    out.push({ url, source, alt });
  };
  for (const i of extractImages(input.releaseNotes ?? '')) add(resolveImageUrl(i.url, input.releaseNotesBase), 'release', i.alt);
  for (const i of input.readme) add(i.url, 'readme', i.alt);
  for (const a of input.assets) if (IMAGE_RE.test(a.name)) add(a.browser_download_url, 'asset');
  return out;
}

/** Probes sizes, drops icons/logos, keeps up to MAX_AUTO and pairs top/bottom shots. */
export async function buildAutoMedia(
  candidates: Candidate[],
  probe: (url: string) => Promise<Uint8Array | null>,
  firstPosition: number,
  firstPair: number,
): Promise<MediaRow[]> {
  const sized: (Candidate & { width: number; height: number })[] = [];
  for (const c of candidates.slice(0, MAX_AUTO * 2)) {
    if (sized.length >= MAX_AUTO) break;
    const size = readSize(await probe(c.url).catch(() => null));
    if (!size || size.width < MIN_WIDTH || size.height < MIN_HEIGHT) continue;
    sized.push({ ...c, ...size });
  }
  const { pairs, rest } = pairByName(sized);
  const rows: MediaRow[] = [];
  const push = (c: (typeof sized)[number], kind: MediaRow['kind'], pair: number | null) =>
    rows.push({ url: c.url, source: c.source, kind, pair, caption: c.alt ?? null, width: c.width, height: c.height, position: firstPosition + rows.length });
  pairs.forEach(([top, bottom], i) => {
    push(top, 'top', firstPair + i);
    push(bottom, 'bottom', firstPair + i);
  });
  for (const c of rest) push(c, 'gallery', null);
  return rows;
}
