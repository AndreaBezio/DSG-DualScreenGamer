/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, games, releaseAssets, uploads, type Db } from '@dsg/db';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupUploads, syncCommunityFiles, syncRetroAchievements } from '../../worker/src/community.ts';
import { GitHubClient } from '../../worker/src/github.ts';
import { syncArtwork, syncRegistry, syncReleases } from '../../worker/src/sync.ts';
import { fakeGitHubFetch, registry } from '../../worker/test/fixtures.ts';
import { createApp } from '../src/app.ts';
import { clearPlatformCache } from '../src/queries.ts';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://dsg:dsg@localhost:5432/dsg_test';
const INTERNAL = 'internal-secret';
const UA = { 'User-Agent': 'dsg-test/1.0' };
let db: Db;
let app: ReturnType<typeof createApp>;
const uploadDir = mkdtempSync(join(tmpdir(), 'dsg-uploads-'));

/** Fake GitHub and Discord OAuth: the code is the user name. */
const oauthFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = String(input);
  if (u.includes('github.com/login/oauth/access_token')) {
    const code = JSON.parse(String(init?.body)).code;
    return Response.json(code === 'bad' ? { error: 'bad_verification_code' } : { access_token: `gh-${code}` });
  }
  if (u === 'https://api.github.com/user') {
    const login = String((init?.headers as Record<string, string>).Authorization).replace('Bearer gh-', '');
    return Response.json({ id: login.length * 1000 + login.charCodeAt(0), login, name: login.toUpperCase(), avatar_url: null });
  }
  if (u.includes('discord.com/api/oauth2/token')) return Response.json({ access_token: 'dc' });
  if (u.includes('discord.com/api/users/@me')) return Response.json({ id: '42', username: 'thorfan', global_name: 'Thor Fan', avatar: null });
  return fakeGitHubFetch()(input, init);
}) as typeof fetch;

async function signIn(provider: 'github' | 'discord', code: string): Promise<string> {
  const res = await app.request('/internal/auth/oauth', {
    method: 'POST',
    headers: { 'x-internal-token': INTERNAL, 'content-type': 'application/json' },
    body: JSON.stringify({ provider, code, redirect_uri: 'http://site/auth/callback' }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as any).token;
}

const call = (path: string, token: string | null, init: RequestInit = {}) =>
  app.request(path, {
    ...init,
    headers: { ...UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(init.headers as object) },
  });

async function png(width: number, height: number, color = '#3fd9a2'): Promise<Blob> {
  const buf = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
  return new Blob([new Uint8Array(buf)], { type: 'image/png' });
}

async function upload(token: string, blob: Blob, name = 'shot.png') {
  const form = new FormData();
  form.set('file', new File([blob], name));
  return call('/v1/uploads', token, { method: 'POST', body: form });
}

let alice: string;
let admin: string;

beforeAll(async () => {
  db = createDb(url);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url)) });
  await db.execute(
    sql`truncate platforms, emulators, devices, games, game_identifiers, game_media, mods, mod_targets, mod_media, mod_releases, release_assets, sync_state, sync_runs, users, user_accounts, sessions, uploads, submissions restart identity cascade`,
  );
  await syncRegistry(db, registry);
  await syncArtwork(db, registry, { fetch: fakeGitHubFetch() });
  clearPlatformCache();
  app = createApp(db, {
    siteUrl: 'https://dsg.test',
    publicUrl: 'https://api.dsg.test',
    account: {
      internalToken: INTERNAL,
      uploadDir,
      uploadMaxBytes: 2 * 1048576,
      oauth: { github: { clientId: 'gh', clientSecret: 's' }, discord: { clientId: 'dc', clientSecret: 's' } },
      admins: { github: ['TheAdmin'] },
      fetch: oauthFetch,
    },
  });
  alice = await signIn('github', 'alice');
  admin = await signIn('github', 'theadmin');
});

afterAll(async () => {
  await db?.$client.end();
});

describe('sign-in', () => {
  it('only accepts calls from the website', async () => {
    const res = await app.request('/internal/auth/oauth', { method: 'POST', body: '{}' });
    expect(res.status).toBe(403);
  });

  it('creates users, promotes configured admins and keeps one account per provider id', async () => {
    expect(((await (await call('/v1/me', alice)).json()) as any)).toMatchObject({ display_name: 'ALICE', role: 'user' });
    expect(((await (await call('/v1/me', admin)).json()) as any).role).toBe('admin');
    const again = await signIn('github', 'alice');
    expect(((await (await call('/v1/me', again)).json()) as any).id).toBe(((await (await call('/v1/me', alice)).json()) as any).id);
    const dc = await signIn('discord', 'whatever');
    expect(((await (await call('/v1/me', dc)).json()) as any).display_name).toBe('Thor Fan');
  });

  it('rejects bad codes, missing and revoked sessions', async () => {
    const bad = await app.request('/internal/auth/oauth', {
      method: 'POST',
      headers: { 'x-internal-token': INTERNAL },
      body: JSON.stringify({ provider: 'github', code: 'bad', redirect_uri: 'x' }),
    });
    expect(bad.status).toBe(502);
    expect((await call('/v1/me', null)).status).toBe(401);
    const t = await signIn('github', 'bob');
    expect((await call('/v1/me/session', t, { method: 'DELETE' })).status).toBe(204);
    expect((await call('/v1/me', t)).status).toBe(401);
  });
});

describe('uploads', () => {
  it('re-encodes screenshots as WebP and serves them', async () => {
    const res = await upload(alice, await png(400, 240));
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ width: 400, height: 240 });
    expect(body.url).toBe(`https://api.dsg.test/media/${body.sha256}.webp`);
    const media = await app.request(`/media/${body.sha256}.webp`);
    expect(media.headers.get('content-type')).toBe('image/webp');
    const meta = await sharp(Buffer.from(await media.arrayBuffer())).metadata();
    expect(meta.format).toBe('webp');
    expect((await app.request(`/media/${body.sha256}.thumb.webp`)).status).toBe(200);
  });

  it('strips EXIF metadata from photos', async () => {
    const jpg = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#123456' } })
      .jpeg()
      .withExif({ IFD0: { Artist: 'secret-name' } })
      .toBuffer();
    const body = (await (await upload(alice, new Blob([new Uint8Array(jpg)]), 'p.jpg')).json()) as any;
    const out = await sharp(Buffer.from(await (await app.request(`/media/${body.sha256}.webp`)).arrayBuffer())).metadata();
    expect(out.exif).toBeUndefined();
  });

  it('refuses tiny images, non-images, oversized files and anonymous uploads', async () => {
    expect((await upload(alice, await png(200, 100))).status).toBe(400);
    expect((await upload(alice, new Blob(['hello']), 'a.txt')).status).toBe(415);
    expect((await upload(alice, new Blob([new Uint8Array(3 * 1048576)]))).status).toBe(413);
    const form = new FormData();
    form.set('file', new File([await png(400, 240)], 'x.png'));
    expect((await call('/v1/uploads', null, { method: 'POST', body: form })).status).toBe(401);
    expect((await app.request('/media/../../etc/passwd')).status).toBe(404);
  });
});

describe('submission lifecycle', () => {
  let top: string;
  let bottom: string;
  let id: string;

  const payload = () => ({
    game: {
      new: {
        title: 'Moon Patrol DX',
        platforms: ['nds'],
        identifiers: [{ kind: 'sha1', value: 'd'.repeat(40), platform: 'nds', region: 'USA' }],
      },
    },
    mod: {
      name: 'Moon Patrol DX — Thor layout',
      type: 'dual_screen_layout',
      summary: 'Radar on the bottom screen.',
      license: 'CC-BY-4.0',
      authors: [{ name: 'Alice' }],
      devices: ['ayn-thor'],
    },
    targets: [{ platform: 'nds', emulator: 'melonds' }],
    screens: { pairs: [{ top, bottom, caption: 'Level 1' }] },
    download: {
      kind: 'manual',
      version: '1.0',
      released_at: '2026-10-01',
      files: [{ label: 'layout.zip', role: 'main', url: 'https://files.example.org/layout.zip' }],
    },
    install: [{ action: 'extract', asset: 'main', to: '{emulator.layouts_dir}' }],
    consent: { rights: true, no_game_files: true },
  });

  beforeAll(async () => {
    top = ((await (await upload(alice, await png(1920, 1080, '#224488'))).json()) as any).sha256;
    bottom = ((await (await upload(alice, await png(1240, 1080, '#884422'))).json()) as any).sha256;
  });

  it('saves drafts and reports every problem before submitting', async () => {
    const res = await call('/v1/me/submissions', alice, { method: 'POST', body: JSON.stringify({ payload: { mod: { name: 'half done' } } }) });
    expect(res.status).toBe(201);
    id = ((await res.json()) as any).id;
    const check = (await (await call(`/v1/me/submissions/${id}/check`, alice, { method: 'POST' })).json()) as any;
    expect(check.ok).toBe(false);
    expect((await call(`/v1/me/submissions/${id}/submit`, alice, { method: 'POST' })).status).toBe(422);
  });

  it('cross-checks the catalog: unknown emulators, foreign uploads, taken identifiers', async () => {
    const bad = payload();
    bad.targets = [{ platform: 'nds', emulator: 'azahar' }];
    bad.game.new.identifiers = [{ kind: 'sha1', value: 'a'.repeat(40), platform: 'nds', region: 'USA' }];
    await call(`/v1/me/submissions/${id}`, alice, { method: 'PATCH', body: JSON.stringify({ payload: bad }) });
    const errors = ((await (await call(`/v1/me/submissions/${id}/check`, alice, { method: 'POST' })).json()) as any).errors.join('\n');
    expect(errors).toMatch(/Azahar does not run nds/);
    expect(errors).toMatch(/already belongs to "pocket-test"/);
    const mallory = await signIn('github', 'mallory');
    const s = (await (await call('/v1/me/submissions', mallory, { method: 'POST', body: JSON.stringify({ payload: payload() }) })).json()) as any;
    const res = (await (await call(`/v1/me/submissions/${s.id}/check`, mallory, { method: 'POST' })).json()) as any;
    expect(res.errors.join('\n')).toMatch(/belongs to another user/);
    expect((await call(`/v1/me/submissions/${s.id}`, alice)).status).toBe(404);
  });

  it('goes to moderation, and only moderators can approve', async () => {
    await call(`/v1/me/submissions/${id}`, alice, { method: 'PATCH', body: JSON.stringify({ payload: payload() }) });
    const sub = await call(`/v1/me/submissions/${id}/submit`, alice, { method: 'POST' });
    expect(sub.status).toBe(200);
    expect(((await sub.json()) as any).status).toBe('pending');
    expect((await call(`/v1/me/submissions/${id}`, alice, { method: 'PATCH', body: '{}' })).status).toBe(409);
    expect((await call(`/v1/admin/submissions/${id}/approve`, alice, { method: 'POST' })).status).toBe(403);
    const queue = (await (await call('/v1/admin/submissions?status=pending', admin)).json()) as any;
    expect(queue.items.map((i: any) => i.id)).toContain(id);
    expect((await call('/v1/mods/moon-patrol-dx-thor-layout', null)).status).toBe(404);
  });

  it('publishes on approval: two-screen preview, manual release, lookup by hash', async () => {
    const res = await call(`/v1/admin/submissions/${id}/approve`, admin, { method: 'POST' });
    expect(res.status).toBe(200);
    const mod = (await (await call('/v1/mods/moon-patrol-dx-thor-layout', null)).json()) as any;
    expect(mod).toMatchObject({ origin: 'community', source_repo: null, manual_download: false, game_id: 'moon-patrol-dx' });
    expect(mod.previews).toEqual([
      expect.objectContaining({
        top: expect.objectContaining({ url: `https://api.dsg.test/media/${top}.webp`, width: 1920, source: 'upload' }),
        bottom: expect.objectContaining({ url: `https://api.dsg.test/media/${bottom}.webp`, width: 1240 }),
        caption: 'Level 1',
      }),
    ]);
    expect(mod.cover_url).toBe(`https://api.dsg.test/media/${top}.webp`);
    expect(mod.latest_release).toMatchObject({ version: '1.0', assets: [expect.objectContaining({ url: 'https://files.example.org/layout.zip', role: 'main' })] });
    const found = (await (await call(`/v1/lookup?platform=nds&sha1=${'D'.repeat(40)}&emulator=melonds&device=ayn-thor`, null)).json()) as any;
    expect(found.mods.map((m: any) => m.id)).toEqual(['moon-patrol-dx-thor-layout']);
  });

  it('survives a registry sync, which only manages registry rows', async () => {
    await syncRegistry(db, registry);
    expect((await call('/v1/mods/moon-patrol-dx-thor-layout', null)).status).toBe(200);
    expect((await call('/v1/games/moon-patrol-dx', null)).status).toBe(200);
  });

  it('edits start from the approved version and need review again', async () => {
    const res = await call('/v1/me/submissions', alice, { method: 'POST', body: JSON.stringify({ mod_id: 'moon-patrol-dx-thor-layout' }) });
    const edit = (await res.json()) as any;
    expect(edit.payload.mod.name).toBe('Moon Patrol DX — Thor layout');
    const changed = { ...edit.payload, game: { existing: 'moon-patrol-dx' }, mod: { ...edit.payload.mod, summary: 'Radar and map below.' } };
    await call(`/v1/me/submissions/${edit.id}`, alice, { method: 'PATCH', body: JSON.stringify({ payload: changed }) });
    expect((await call(`/v1/me/submissions/${edit.id}/submit`, alice, { method: 'POST' })).status).toBe(200);
    expect(((await (await call('/v1/mods/moon-patrol-dx-thor-layout', null)).json()) as any).summary).toBe('Radar on the bottom screen.');
    expect((await call(`/v1/admin/submissions/${edit.id}/request-changes`, admin, { method: 'POST', body: '{}' })).status).toBe(400);
    await call(`/v1/admin/submissions/${edit.id}/approve`, admin, { method: 'POST' });
    expect(((await (await call('/v1/mods/moon-patrol-dx-thor-layout', null)).json()) as any).summary).toBe('Radar and map below.');
    // Somebody else cannot edit it
    const bob = await signIn('github', 'bob');
    expect((await call('/v1/me/submissions', bob, { method: 'POST', body: JSON.stringify({ mod_id: 'moon-patrol-dx-thor-layout' }) })).status).toBe(403);
  });

  it('lets moderators unpublish mods and ban users', async () => {
    await call('/v1/admin/mods/moon-patrol-dx-thor-layout/published', admin, { method: 'POST', body: JSON.stringify({ published: false }) });
    expect((await call('/v1/mods/moon-patrol-dx-thor-layout', null)).status).toBe(404);
    await call('/v1/admin/mods/moon-patrol-dx-thor-layout/published', admin, { method: 'POST', body: JSON.stringify({ published: true }) });
    const me = (await (await call('/v1/me', alice)).json()) as any;
    await call(`/v1/admin/users/${me.id}/banned`, admin, { method: 'POST', body: JSON.stringify({ banned: true }) });
    expect((await call('/v1/me', alice)).status).toBe(401);
    expect((await call('/v1/mods/moon-patrol-dx-thor-layout', null)).status).toBe(404);
  });
});

describe('worker steps for community content', () => {
  it('hashes directly linked files once', async () => {
    const file = new TextEncoder().encode('layout-bytes');
    const fetchFile = (async (u: string | URL | Request) =>
      String(u) === 'https://files.example.org/layout.zip'
        ? new Response(file, { headers: { 'content-type': 'application/zip' } })
        : new Response('no', { status: 404 })) as typeof fetch;
    const r = await syncCommunityFiles(db, { fetch: fetchFile });
    expect(r).toEqual({ updated: 1, errors: [] });
    const mod = (await (await call('/v1/admin/submissions?status=approved', admin)).json()) as any;
    expect(mod.items.length).toBeGreaterThan(0);
    const [asset] = await db.select().from(releaseAssets).where(eq(releaseAssets.url, 'https://files.example.org/layout.zip'));
    expect(asset).toMatchObject({ size: file.byteLength, contentType: 'application/zip' });
    expect(asset!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await syncCommunityFiles(db, { fetch: fetchFile })).updated).toBe(0);
  });

  it('links RetroAchievements ids by MD5 when a key is configured', async () => {
    await syncArtwork(db, registry, { fetch: fakeGitHubFetch() });
    const raFetch = (async (u: string | URL | Request) => {
      const url = new URL(String(u));
      expect(url.searchParams.get('y')).toBe('ra-key');
      return Response.json(url.searchParams.get('i') === '5' ? [{ ID: 515, Hashes: ['A104896DA0047ABE8BEE2A6E3F4C7290'] }] : []);
    }) as typeof fetch;
    const catalog = { ...registry.catalog, platforms: registry.catalog.platforms.map((p) => (p.id === 'gba' ? { ...p, retroachievements: [5] } : p)) };
    const r = await syncRetroAchievements(db, { ...registry, catalog }, 'ra-key', { fetch: raFetch });
    expect(r).toEqual({ updated: 1, errors: [] });
    const found = (await (await call('/v1/lookup?ra=515', null)).json()) as any;
    expect(found.game.id).toBe('tiny-cap');
    // The RA id stands for the USA dump, so the USA-only port matches
    expect(found.mods.map((m: any) => m.id)).toEqual(['tiny-cap-port']);
  });

  it('removes week-old uploads that nothing uses', async () => {
    const orphan = ((await (await upload(admin, await png(500, 300, '#ff00ff'))).json()) as any).sha256;
    await db.update(uploads).set({ createdAt: new Date(Date.now() - 8 * 86_400_000) });
    // The orphan plus the two images uploaded by the upload tests, which no submission uses
    expect(await cleanupUploads(db, uploadDir)).toBe(3);
    expect((await app.request(`/media/${orphan}.webp`)).status).toBe(404);
    // Screenshots of the published mod (and of mallory's draft) are kept
    const mod = (await (await call('/v1/admin/submissions?status=approved', admin)).json()) as any;
    expect(mod.items.length).toBeGreaterThan(0);
    expect((await db.select().from(uploads)).length).toBe(2);
  });
});

describe('frontend API', () => {
  beforeAll(async () => {
    // As in runSync: artwork follows a registry sync; releases come from (fake) GitHub
    await syncRegistry(db, registry);
    await syncArtwork(db, registry, { fetch: fakeGitHubFetch() });
    await syncReleases(db, registry, { github: new GitHubClient(undefined, fakeGitHubFetch(), 'https://gh.test') });
    await db.update(games).set({ igdbId: 1035 }).where(eq(games.id, 'test-quest'));
    clearPlatformCache();
  });

  it('accepts platform aliases and other catalogs\' ids', async () => {
    const byAlias = await call('/v1/lookup?platform=igdb:37&title_id=00040000000AAAA0', null);
    expect(((await byAlias.json()) as any).game.id).toBe('test-quest');
    const cocoon = await call('/v1/lookup?platform=n3ds&title_id=00040000000AAAA0', null);
    expect(((await cocoon.json()) as any).game.id).toBe('test-quest');
    expect((await call('/v1/lookup?platform=nowhere&title_id=00040000000AAAA0', null)).status).toBe(400);
  });

  it('looks up by IGDB id and by No-Intro file name', async () => {
    const igdb = (await (await call('/v1/lookup?igdb=1035', null)).json()) as any;
    expect(igdb.matched).toEqual({ kind: 'igdb', value: '1035' });
    // The IGDB id names the game, not a dump: the USA-only pack still shows up
    expect(igdb.mods.map((m: any) => m.id)).toEqual(['test-quest-hd']);
    const byName = (await (await call(`/v1/lookup?filename=${encodeURIComponent('/roms/gba/Legend of Zelda, The - The Minish Cap (USA).gba')}`, null)).json()) as any;
    expect(byName.game.id).toBe('tiny-cap');
    expect(byName.mods.map((m: any) => m.id)).toEqual(['tiny-cap-port']);
  });

  it('looks up a whole library in one request', async () => {
    const res = await call('/v1/lookup/batch', null, {
      method: 'POST',
      body: JSON.stringify({
        device: 'ayn-thor',
        items: [
          { ref: 'a.gba', crc32: 'ABCEBBB1' },
          { ref: 'b.nds', sha1: 'f'.repeat(40) },
          { ref: 'c.3ds', title_id: '00040000000aaaa0' },
        ],
      }),
    });
    const body = (await res.json()) as any;
    expect(body.results.map((r: any) => [r.ref, r.game_id, r.mod_ids])).toEqual([
      ['a.gba', 'tiny-cap', ['tiny-cap-port']],
      ['b.nds', null, []],
      ['c.3ds', 'test-quest', ['test-quest-hd']],
    ]);
    expect(Object.keys(body.mods).sort()).toEqual(['test-quest-hd', 'tiny-cap-port']);
    const tooMany = await call('/v1/lookup/batch', null, { method: 'POST', body: JSON.stringify({ items: Array.from({ length: 501 }, () => ({ crc32: '1' })) }) });
    expect(tooMany.status).toBe(400);
  });

  it('serves a compact index with ETag revalidation', async () => {
    const res = await call('/v1/index/compact.json', null);
    const body = (await res.json()) as any;
    expect(body.keys['crc32:abcebbb1']).toBe('tiny-cap');
    expect(body.keys['igdb:1035']).toBe('test-quest');
    expect(body.games['tiny-cap']).toEqual(['tiny-cap-port']);
    expect((await call('/v1/index/compact.json', null, { headers: { 'If-None-Match': res.headers.get('etag')! } })).status).toBe(304);
  });

  it('reports only mods with a newer release', async () => {
    const res = await call('/v1/updates?installed=test-quest-hd@1.0,pocket-test-layout@0.3,unknown@1', null);
    const body = (await res.json()) as any;
    expect(body.items.map((i: any) => [i.mod_id, i.installed, i.latest.version])).toEqual([['test-quest-hd', '1.0', '1.1.0']]);
    const post = await call('/v1/updates', null, { method: 'POST', body: JSON.stringify({ installed: [{ mod_id: 'test-quest-hd', version: '1.1.0' }] }) });
    expect(((await post.json()) as any).items).toEqual([]);
  });

  it('publishes Atom and JSON feeds', async () => {
    const atom = await (await call('/v1/feed.atom', null)).text();
    expect(atom).toMatch(/^<\?xml/);
    expect(atom).toContain('<entry>');
    expect(atom).toContain('https://dsg.test/mods/');
    const feed = (await (await call('/v1/feed.json?type=texture_pack', null)).json()) as any;
    expect(feed.version).toBe('https://jsonfeed.org/version/1.1');
    expect(feed.items.every((i: any) => i._dsg.mod_id === 'test-quest-hd')).toBe(true);
  });
});
