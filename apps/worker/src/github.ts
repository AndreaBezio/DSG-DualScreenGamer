import { createHash } from 'node:crypto';
import { matchesGlob } from './glob.ts';

export type GhAsset = {
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
  download_count: number;
  digest?: string | null;
};
export type GhRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: GhAsset[];
};

export type ResolvedAsset = {
  role: string;
  name: string;
  url: string;
  size: number;
  sha256: string | null;
  contentType: string | null;
  downloadCount: number | null;
};
export type ResolvedRelease = {
  tag: string;
  version: string;
  name: string | null;
  prerelease: boolean;
  publishedAt: Date;
  changelog: string | null;
  htmlUrl: string;
  assets: ResolvedAsset[];
};

export type FetchLike = typeof fetch;

export class GitHubClient {
  constructor(
    private token: string | undefined = process.env.GITHUB_TOKEN || undefined,
    private fetchImpl: FetchLike = fetch,
    private apiBase = 'https://api.github.com',
  ) {}

  private headers(etag?: string): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dsg-worker',
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (etag) h['If-None-Match'] = etag;
    return h;
  }

  async repo(fullName: string): Promise<{ stargazers_count: number } | null> {
    const res = await this.fetchImpl(`${this.apiBase}/repos/${fullName}`, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${fullName}: HTTP ${res.status}`);
    return (await res.json()) as { stargazers_count: number };
  }

  /** Conditional request: returns `notModified` when the ETag still matches (does not count against the rate limit). */
  async releases(
    fullName: string,
    etag?: string,
  ): Promise<{ notModified: true } | { notModified: false; etag: string | null; releases: GhRelease[] }> {
    const res = await this.fetchImpl(`${this.apiBase}/repos/${fullName}/releases?per_page=30`, {
      headers: this.headers(etag),
    });
    if (res.status === 304) return { notModified: true };
    if (!res.ok) throw new Error(`GitHub releases ${fullName}: HTTP ${res.status}`);
    return { notModified: false, etag: res.headers.get('etag'), releases: (await res.json()) as GhRelease[] };
  }

  /** README as text plus the raw URL it lives at (used to resolve relative image paths). */
  async readme(
    fullName: string,
    etag?: string,
  ): Promise<{ notModified: true } | { notModified: false; etag: string | null; text: string; downloadUrl: string } | null> {
    const res = await this.fetchImpl(`${this.apiBase}/repos/${fullName}/readme`, { headers: this.headers(etag) });
    if (res.status === 304) return { notModified: true };
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub readme ${fullName}: HTTP ${res.status}`);
    const body = (await res.json()) as { content: string; encoding: string; download_url: string };
    const text = body.encoding === 'base64' ? Buffer.from(body.content, 'base64').toString('utf8') : body.content;
    return { notModified: false, etag: res.headers.get('etag'), text, downloadUrl: body.download_url };
  }

  /** Reads just the start of an image: enough for its dimensions. */
  async imageHead(url: string, maxBytes = 65536): Promise<Uint8Array | null> {
    const res = await this.fetchImpl(url, {
      headers: { 'User-Agent': 'dsg-worker', Range: `bytes=0-${maxBytes - 1}` },
      redirect: 'follow',
    });
    if (!res.ok || !res.body) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    return Buffer.concat(chunks).subarray(0, maxBytes);
  }

  /** Fallback when GitHub didn't provide a digest: stream the file and hash it. */
  async sha256OfUrl(url: string, maxBytes: number): Promise<string | null> {
    const res = await this.fetchImpl(url, { headers: { 'User-Agent': 'dsg-worker' }, redirect: 'follow' });
    if (!res.ok || !res.body) return null;
    const hash = createHash('sha256');
    let total = 0;
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > maxBytes) return null;
      hash.update(chunk);
    }
    return hash.digest('hex');
  }
}

export function versionFromTag(tag: string): string {
  const m = tag.match(/\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?/);
  return m ? m[0] : tag;
}

/** Applies the manifest's source rules to raw GitHub releases. Newest first. */
export type ReleaseSource = { assets: { role: string; pattern: string }[]; prereleases: boolean; tag_pattern?: string };

export function resolveReleases(mod: { source: ReleaseSource }, releases: GhRelease[]): ResolvedRelease[] {
  const { assets: patterns, prereleases, tag_pattern } = mod.source;
  return releases
    .filter((r) => !r.draft && r.published_at)
    .filter((r) => prereleases || !r.prerelease)
    .filter((r) => !tag_pattern || matchesGlob(r.tag_name, tag_pattern))
    .map((r) => {
      const assets: ResolvedAsset[] = [];
      for (const a of r.assets) {
        // First matching pattern decides the role
        const p = patterns.find((p) => matchesGlob(a.name, p.pattern));
        if (!p) continue;
        const digest = a.digest?.startsWith('sha256:') ? a.digest.slice(7) : null;
        assets.push({
          role: p.role,
          name: a.name,
          url: a.browser_download_url,
          size: a.size,
          sha256: digest,
          contentType: a.content_type || null,
          downloadCount: a.download_count ?? null,
        });
      }
      return {
        tag: r.tag_name,
        version: versionFromTag(r.tag_name),
        name: r.name,
        prerelease: r.prerelease,
        publishedAt: new Date(r.published_at!),
        changelog: r.body,
        htmlUrl: r.html_url,
        assets,
      };
    })
    .filter((r) => r.assets.length > 0)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}
