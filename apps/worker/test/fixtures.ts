import type { GhRelease } from '../src/github.ts';
import type { Registry } from '../src/registry.ts';

// Test-only data: invented games and repos, never published.
export const registry: Registry = {
  catalog: {
    platforms: [
      { id: '3ds', name: 'Nintendo 3DS', kind: 'handheld', screens: 2 },
      { id: 'nds', name: 'Nintendo DS', kind: 'handheld', screens: 2 },
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
      requires: [],
      devices: [],
      source: { github: 'tester/test-quest-hd', prereleases: false, assets: [{ role: 'main', pattern: '*.zip' }] },
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
      requires: [],
      devices: ['ayn-thor'],
      source: { github: 'tester/pocket-layout', prereleases: false, assets: [{ role: 'main', pattern: '*.{json,zip}' }] },
      targets: [{ platform: 'nds', identifiers: [] }],
      install: [{ action: 'copy', asset: 'main', to: '{emulator.layouts_dir}' }],
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
  'tester/test-quest-hd': [
    {
      tag_name: 'v1.1.0',
      name: 'HD 1.1',
      body: 'fixes',
      draft: false,
      prerelease: false,
      published_at: '2026-09-01T00:00:00Z',
      html_url: 'https://github.com/tester/test-quest-hd/releases/tag/v1.1.0',
      assets: [asset('test-quest-hd.zip', `sha256:${'b'.repeat(64)}`), asset('README.md')],
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

/** Stand-in for GitHub's REST API with ETag support. */
export function fakeGitHubFetch(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/releases)?$/);
    if (!m) return new Response('not found', { status: 404 });
    const data = releases[m[1]!];
    if (!data) return new Response('{}', { status: 404 });
    if (!m[2]) return Response.json({ stargazers_count: 42 });
    const etag = `"etag-${m[1]}"`;
    const sent = (init?.headers as Record<string, string> | undefined)?.['If-None-Match'];
    if (sent === etag) return new Response(null, { status: 304 });
    return Response.json(data, { headers: { etag } });
  }) as typeof fetch;
}
