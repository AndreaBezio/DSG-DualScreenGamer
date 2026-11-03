import { readFileSync } from 'node:fs';
import { GitHubClient, type GhRelease } from '../src/github.ts';
import type { Registry } from '../src/registry.ts';

// Test-only data: invented games and repos, never published.
export const registry: Registry = {
  catalog: {
    platforms: [
      { id: '3ds', name: 'Nintendo 3DS', kind: 'handheld', screens: 2, igdb: 37, aliases: ['n3ds'] },
      { id: 'gba', name: 'Game Boy Advance', kind: 'handheld', screens: 1, aliases: [], libretro: { system: 'Nintendo - Game Boy Advance', dat: 'no-intro' } },
      { id: 'nds', name: 'Nintendo DS', kind: 'handheld', screens: 2, aliases: [] },
    ],
    emulators: [
      { id: 'azahar', name: 'Azahar', kind: 'emulator', platforms: ['3ds'], os: ['android'] },
      { id: 'melonds', name: 'melonDS', kind: 'emulator', platforms: ['nds'], os: ['android'] },
    ],
    devices: [{ id: 'ayn-thor', name: 'AYN Thor', manufacturer: 'AYN', os: 'android', screens: 2 }],
  },
  games: [
    {
      id: 'test-quest',
      title: 'Test Quest',
      platforms: ['3ds'],
      identifiers: [
        { kind: 'title_id', value: '00040000000AAAA0', platform: '3ds', region: 'USA' },
        { kind: 'title_id', value: '00040000000BBBB0', platform: '3ds', region: 'EUR' },
      ],
    },
    {
      id: 'pocket-test',
      title: 'Pocket Test',
      platforms: ['nds'],
      identifiers: [{ kind: 'sha1', value: 'a'.repeat(40), platform: 'nds' }],
    },
    {
      // Real No-Intro entry (test/data/gba-excerpt.dat): exercises DAT enrichment and thumbnails
      id: 'tiny-cap',
      title: 'Tiny Cap',
      platforms: ['gba'],
      identifiers: [{ kind: 'sha1', value: 'b4bd50e4131b027c334547b4524e2dbbd4227130', platform: 'gba', region: 'USA' }],
    },
  ],
  mods: [
    {
      id: 'test-quest-hd',
      name: 'Test Quest HD',
      type: 'texture_pack',
      summary: 'HD textures (USA only)',
      game: 'test-quest',
      authors: [{ name: 'tester' }],
      license: 'MIT',
      tags: [],
      screenshots: [],
      previews: [],
      requires: [],
      devices: [],
      source: { github: 'tester/test-quest-hd', prereleases: false, auto_media: true, assets: [{ role: 'main', pattern: '*.zip' }] },
      targets: [{ platform: '3ds', emulator: 'azahar', min_version: '2120', identifiers: [{ kind: 'title_id', value: '00040000000AAAA0' }] }],
      install: [{ action: 'extract', asset: 'main', to: '{emulator.textures_dir}/{game.title_id}' }],
    },
    {
      id: 'pocket-test-layout',
      name: 'Pocket Test Thor Layout',
      type: 'dual_screen_layout',
      summary: 'Layout for the Thor',
      game: 'pocket-test',
      authors: [{ name: 'tester' }],
      license: 'CC-BY-4.0',
      tags: [],
      screenshots: [],
      previews: [],
      requires: [],
      devices: ['ayn-thor'],
      source: { github: 'tester/pocket-layout', prereleases: false, auto_media: true, assets: [{ role: 'main', pattern: '*.{json,zip}' }] },
      targets: [{ platform: 'nds', identifiers: [] }],
      install: [{ action: 'copy', asset: 'main', to: '{emulator.layouts_dir}' }],
    },
    {
      id: 'tiny-cap-port',
      name: 'Tiny Cap Port',
      type: 'port',
      summary: 'Native port, USA dump only',
      game: 'tiny-cap',
      authors: [{ name: 'tester' }],
      license: 'GPL-3.0',
      tags: [],
      screenshots: [],
      previews: [],
      requires: [],
      devices: ['ayn-thor'],
      source: { github: 'tester/tiny-cap-port', prereleases: false, auto_media: false, assets: [{ role: 'main', pattern: '*.apk' }] },
      targets: [{ platform: 'gba', identifiers: [{ kind: 'sha1', value: 'b4bd50e4131b027c334547b4524e2dbbd4227130' }] }],
      install: [{ action: 'install_apk', asset: 'main' }],
    },
  ],
};

const asset = (name: string, digest: string | null = null) => ({
  name,
  size: 1234,
  browser_download_url: `https://github.com/tester/repo/releases/download/x/${name}`,
  content_type: 'application/zip',
  download_count: 7,
  digest,
});

export const releases: Record<string, GhRelease[]> = {
  'tester/tiny-cap-port': [],
  'tester/test-quest-hd': [
    {
      tag_name: 'v1.1.0',
      name: 'HD 1.1',
      body: 'fixes\n\n![HD comparison](https://img.test/compare.png)\n[![build](https://img.shields.io/badge/build-ok-green)](x)',
      draft: false,
      prerelease: false,
      published_at: '2026-09-01T00:00:00Z',
      html_url: 'https://github.com/tester/test-quest-hd/releases/tag/v1.1.0',
      assets: [asset('test-quest-hd.zip', `sha256:${'b'.repeat(64)}`), asset('README.md'), asset('attached-shot.webp')],
    },
    {
      tag_name: 'v1.2.0-beta',
      name: null,
      body: null,
      draft: false,
      prerelease: true,
      published_at: '2026-10-01T00:00:00Z',
      html_url: 'https://github.com/tester/test-quest-hd/releases/tag/v1.2.0-beta',
      assets: [asset('test-quest-hd.zip')],
    },
    {
      tag_name: 'v1.0.0',
      name: 'HD 1.0',
      body: null,
      draft: false,
      prerelease: false,
      published_at: '2026-08-01T00:00:00Z',
      html_url: 'https://github.com/tester/test-quest-hd/releases/tag/v1.0.0',
      assets: [asset('test-quest-hd.zip')],
    },
  ],
  'tester/pocket-layout': [
    {
      tag_name: '0.3',
      name: 'Layout 0.3',
      body: null,
      draft: false,
      prerelease: false,
      published_at: '2026-07-01T00:00:00Z',
      html_url: 'https://github.com/tester/pocket-layout/releases/tag/0.3',
      assets: [asset('layout.json')],
    },
  ],
};

export const readmes: Record<string, string> = {
  'tester/test-quest-hd': [
    '# Test Quest HD',
    '[![stars](https://img.shields.io/github/stars/tester/test-quest-hd)](x)',
    '<img src="logo.png" alt="logo" width="64">',
    '![Battle, top screen](docs/battle-top.png)',
    '![Battle, bottom screen](docs/battle-bottom.png)',
    '<img src="https://github.com/tester/test-quest-hd/blob/main/docs/town.jpg" alt="Town">',
    '![diagram](docs/flow.svg)',
  ].join('\n'),
};

/** Image sizes served by the fake image host, by file name. */
export const imageSizes: Record<string, [number, number]> = {
  'compare.png': [1280, 720],
  'logo.png': [64, 64],
  'battle-top.png': [1920, 1080],
  'battle-bottom.png': [1240, 1080],
  'town.jpg': [800, 600],
  'attached-shot.webp': [1920, 1080],
};

/** First bytes of a PNG with the given size: enough for image-size. */
export function pngHead(width: number, height: number): Uint8Array {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8;
  b[25] = 6;
  return b;
}

/** Stand-in for GitHub's REST API with ETag support. */
export function fakeGitHubFetch(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const sent = (init?.headers as Record<string, string> | undefined)?.['If-None-Match'];
    if (url.pathname.startsWith('/libretro/libretro-database/')) {
      return new Response(readFileSync(new URL('./data/gba-excerpt.dat', import.meta.url), 'utf8'));
    }
    if (url.pathname.startsWith('/libretro-thumbnails/')) {
      return new Response(null, { status: url.pathname.includes('Named_Titles') ? 404 : 200 });
    }
    if (url.hostname !== 'gh.test') {
      // Any other host is the image CDN (raw.githubusercontent.com, release downloads, img.test)
      const name = url.pathname.split('/').pop()!;
      const size = imageSizes[name];
      return size ? new Response(pngHead(...size)) : new Response('missing', { status: 404 });
    }
    const readme = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/readme$/);
    if (readme) {
      const text = readmes[readme[1]!];
      if (!text) return new Response('{}', { status: 404 });
      const etag = `"readme-${readme[1]}"`;
      if (sent === etag) return new Response(null, { status: 304 });
      return Response.json(
        {
          content: Buffer.from(text).toString('base64'),
          encoding: 'base64',
          download_url: `https://raw.githubusercontent.com/${readme[1]}/main/README.md`,
        },
        { headers: { etag } },
      );
    }
    const m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/releases)?$/);
    if (!m) return new Response('not found', { status: 404 });
    const data = releases[m[1]!];
    if (!data) return new Response('{}', { status: 404 });
    if (!m[2]) return Response.json({ stargazers_count: 42 });
    const etag = `"etag-${m[1]}"`;
    if (sent === etag) return new Response(null, { status: 304 });
    return Response.json(data, { headers: { etag } });
  }) as typeof fetch;
}

/** GitHub client wired to the fake API; test hosts don't resolve, so the URL guard lets everything through. */
export function testGitHub(): GitHubClient {
  return new GitHubClient(undefined, fakeGitHubFetch(), 'https://gh.test', async () => true);
}
