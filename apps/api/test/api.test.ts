/* eslint-disable @typescript-eslint/no-explicit-any */
import { fileURLToPath } from 'node:url';
import { createDb, type Db } from '@dsg/db';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitHubClient } from '../../worker/src/github.ts';
import { getState, syncRegistry, syncReleases } from '../../worker/src/sync.ts';
import { fakeGitHubFetch, registry } from '../../worker/test/fixtures.ts';
import { createApp } from '../src/app.ts';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://dsg:dsg@localhost:5432/dsg_test';
let db: Db;
let app: ReturnType<typeof createApp>;

const get = (path: string, headers: Record<string, string> = {}) =>
  app.request(path, { headers: { 'User-Agent': 'dsg-test/1.0', ...headers } });

beforeAll(async () => {
  db = createDb(url);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url)) });
  await db.execute(
    sql`truncate platforms, emulators, devices, games, game_identifiers, mods, mod_targets, mod_releases, release_assets, sync_state, sync_runs restart identity cascade`,
  );
  await syncRegistry(db, registry);
  const github = new GitHubClient(undefined, fakeGitHubFetch(), 'https://gh.test');
  const res = await syncReleases(db, registry, { github });
  expect(res.errors).toEqual([]);
  app = createApp(db, { adminToken: 'secret-token' });
});

afterAll(async () => {
  await db?.$client.end();
});

describe('sync', () => {
  it('stores etags and skips unchanged repos', async () => {
    const [row] = await db.execute<{ value: { v: string } }>(sql`select value from sync_state where key like 'gh_etag:test-quest-hd:%'`);
    expect(row!.value.v).toBe('"etag-tester/test-quest-hd"');
    const github = new GitHubClient(undefined, fakeGitHubFetch(), 'https://gh.test');
    expect((await syncReleases(db, registry, { github })).updated).toBe(0);
  });

  it('is idempotent and removes mods that left the registry', async () => {
    await syncRegistry(db, { ...registry, mods: registry.mods.slice(0, 1) });
    expect((await (await get('/v1/mods')).json() as any).items).toHaveLength(1);
    await syncRegistry(db, registry);
    // Releases were cascaded away with the mod; the cached ETag must not hide them now
    const github = new GitHubClient(undefined, fakeGitHubFetch(), 'https://gh.test');
    expect((await syncReleases(db, registry, { github })).updated).toBe(1);
    const items = (await (await get('/v1/mods')).json() as any).items;
    expect(items).toHaveLength(2);
    expect(items.every((m: any) => m.latest_release)).toBe(true);
  });
});

describe('GET /v1/lookup', () => {
  it('finds the game and its mods by title id, case-insensitively', async () => {
    const res = await get('/v1/lookup?platform=3ds&title_id=00040000000aaaa0&emulator=azahar&emulator_version=2121');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.game.id).toBe('test-quest');
    expect(body.matched).toEqual({ kind: 'title_id', value: '00040000000AAAA0' });
    expect(body.mods.map((m: { id: string }) => m.id)).toEqual(['test-quest-hd']);
    const latest = body.mods[0].latest_release;
    expect(latest.tag).toBe('v1.1.0');
    expect(latest.assets[0]).toMatchObject({ role: 'main', sha256: 'b'.repeat(64), size: 1234 });
    expect(body.mods[0].install[0].to).toBe('{emulator.textures_dir}/{game.title_id}');
  });

  it('excludes mods restricted to another region', async () => {
    const body = (await (await get('/v1/lookup?title_id=00040000000BBBB0')).json()) as any;
    expect(body.game.id).toBe('test-quest');
    expect(body.mods).toEqual([]);
  });

  it('excludes mods when the emulator is too old or different', async () => {
    expect((await (await get('/v1/lookup?title_id=00040000000AAAA0&emulator=azahar&emulator_version=2000')).json() as any).mods).toEqual([]);
  });

  it('applies device filters and accepts hashes', async () => {
    const sha1 = 'A'.repeat(40);
    expect((await (await get(`/v1/lookup?platform=nds&sha1=${sha1}&device=ayn-thor`)).json() as any).mods).toHaveLength(1);
    expect((await (await get(`/v1/lookup?platform=nds&sha1=${sha1}&device=dual-monitor-pc`)).json() as any).mods).toHaveLength(0);
  });

  it('returns 404 for unknown games and 400 without identifiers', async () => {
    expect((await get('/v1/lookup?sha1=' + 'c'.repeat(40))).status).toBe(404);
    expect((await get('/v1/lookup?platform=nds')).status).toBe(400);
  });

  it('requires a User-Agent', async () => {
    expect((await app.request('/v1/lookup?sha1=x')).status).toBe(400);
  });
});

describe('catalog endpoints', () => {
  it('lists and searches games', async () => {
    const body = (await (await get('/v1/games?q=quest')).json()) as any;
    expect(body.items.map((g: { id: string }) => g.id)).toEqual(['test-quest']);
    expect(body.items[0].mod_count).toBe(1);
    expect((await (await get('/v1/games?platform=nds')).json() as any).items).toHaveLength(1);
  });

  it('serves mods, releases and latest release', async () => {
    expect((await get('/v1/mods/test-quest-hd')).status).toBe(200);
    expect((await get('/v1/mods/nope')).status).toBe(404);
    const rel = (await (await get('/v1/mods/test-quest-hd/releases')).json()) as any;
    expect(rel.items.map((r: { tag: string }) => r.tag)).toEqual(['v1.1.0', 'v1.0.0']);
    const latest = (await (await get('/v1/mods/pocket-test-layout/releases/latest')).json()) as any;
    expect(latest).toMatchObject({ mod_id: 'pocket-test-layout', version: '0.3' });
  });

  it('serves the index with ETag revalidation', async () => {
    const res = await get('/v1/index.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.mods).toHaveLength(2);
    expect(body.platforms).toHaveLength(2);
    expect((await get('/v1/index.json', { 'If-None-Match': res.headers.get('etag')! })).status).toBe(304);
  });

  it('publishes an OpenAPI document', async () => {
    const doc = (await (await get('/v1/openapi.json')).json()) as any;
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toContain('/v1/lookup');
  });
});

describe('admin', () => {
  it('requires the token to request a sync', async () => {
    expect((await app.request('/admin/sync', { method: 'POST' })).status).toBe(401);
    const res = await app.request('/admin/sync', { method: 'POST', headers: { Authorization: 'Bearer secret-token' } });
    expect(res.status).toBe(202);
    expect(await getState<number>(db, 'sync_requested_at')).toBeGreaterThan(0);
  });
});
