import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { syncState, type Db } from '@dsg/db';
import { IDENTIFIER_KINDS, MOD_TYPES, type IdentifierKind } from '@dsg/schema';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import {
  DeviceDetailDto,
  DeviceDto,
  EmulatorDto,
  ErrorDto,
  GameDto,
  LookupDto,
  ModDto,
  page,
  PlatformDto,
  ReleaseDto,
} from './dto.ts';
import { accountRoutes, type AccountOptions } from './account.ts';
import { safeEqual } from './auth.ts';
import * as fe from './frontend.ts';
import { installRoutes } from './installs.ts';
import { reportRoutes } from './reports.ts';
import * as q from './queries.ts';
import { rateLimit } from './rate-limit.ts';

export type AppOptions = {
  adminToken?: string;
  rateLimitPerMinute?: number;
  trustProxy?: boolean;
  publicUrl?: string;
  /** Key for the daily install-dedupe hashes (random per process when unset) */
  installSalt?: string;
  /** Website base URL, for links in feeds */
  siteUrl?: string;
  account?: AccountOptions;
};

const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});
const notFound = { 404: json(ErrorDto, 'Not found') };

const Id = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'stardew-valley-dual-screen' }) });

const PLATFORM_HELP =
  'Our id, an alias, or another catalog\'s id: igdb:24, ra:5, screenscraper:12, launchbox:Nintendo DS, libretro:Nintendo - Game Boy Advance, thegamesdb:5';

const ModFilterQuery = z.object({
  platform: z.string().optional().openapi({ example: 'nds', description: PLATFORM_HELP }),
  emulator: z.string().optional().openapi({ example: 'melonds', description: 'Emulator id from /v1/emulators' }),
  emulator_version: z.string().optional().openapi({ example: '1.0' }),
  device: z.string().optional().openapi({ example: 'ayn-thor' }),
  type: z.enum(MOD_TYPES).optional(),
});

const KeysShape = {
  ...(Object.fromEntries(IDENTIFIER_KINDS.map((k) => [k, z.string().optional()])) as Record<IdentifierKind, z.ZodOptional<z.ZodString>>),
  ra: z.string().optional().openapi({ description: 'RetroAchievements game id (same as retroachievements=)' }),
  igdb: z.string().optional().openapi({ description: 'IGDB game id', example: '1035' }),
  filename: z
    .string()
    .optional()
    .openapi({ description: 'No-Intro / Redump file name, path and extension are ignored', example: 'Legend of Zelda, The - The Minish Cap (USA).gba' }),
};
const LookupQuery = ModFilterQuery.extend(KeysShape);


function etagFor(body: string): string {
  return `"${createHash('sha1').update(body).digest('base64url')}"`;
}

export function createApp(db: Db, opts: AppOptions = {}) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
      }
    },
  });

  const internal = opts.account?.internalToken ?? '';
  // The website calls on behalf of many visitors: it is identified by the shared token, not rate limited
  const fromWebsite = (c: { req: { header: (n: string) => string | undefined } }) => safeEqual(c.req.header('x-internal-token') ?? '', internal);
  app.use('/v1/*', cors({ origin: '*', allowMethods: ['GET', 'HEAD', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
  app.use('/v1/*', compress());
  app.use('/v1/*', rateLimit(opts.rateLimitPerMinute ?? 120, opts.trustProxy ?? false, fromWebsite));
  app.use('/v1/*', async (c, next) => {
    if (c.req.method === 'GET' && !c.req.header('user-agent')) {
      return c.json({ error: 'please send a User-Agent identifying your app, e.g. "MyEmu/1.2 (+https://example.org)"' }, 400);
    }
    await next();
    if (c.req.method === 'GET' && c.res.status === 200 && !c.res.headers.has('Cache-Control')) {
      c.header('Cache-Control', 'public, max-age=60');
    }
  });

  app.get('/healthz', (c) => c.text('ok'));

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/lookup',
      tags: ['emulators'],
      summary: 'Find a game and its compatible mods from what the emulator knows',
      description:
        'Send at least one identifier (ROM hash, title id, serial, store id). Identifiers are tried in the order ' +
        'sha1, md5, crc32, title_id, serial, steam_appid, gog_id, android_pkg. Optional filters narrow mods to the ' +
        'running emulator/version and device.',
      request: { query: LookupQuery },
      responses: { 200: json(LookupDto, 'Game and compatible mods'), 400: json(ErrorDto, 'No identifier'), ...notFound },
    }),
    async (c) => {
      const query = c.req.valid('query');
      const keys = fe.keysFrom(query);
      if (!fe.hasKeys(keys)) return c.json({ error: `send one of: ${IDENTIFIER_KINDS.join(', ')}, ra, igdb, filename` }, 400);
      const r = await fe.resolveFilter(db, query);
      if ('error' in r) return c.json({ error: r.error }, 400);
      const result = await q.lookup(db, keys, r.filter);
      if (!result) return c.json({ error: 'unknown game' }, 404);
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/lookup/batch',
      tags: ['emulators'],
      summary: 'Look up a whole library at once (max 500 items)',
      description:
        'Each item takes the same keys as /v1/lookup plus an optional `ref` echoed back. Mods are returned once in `mods`.',
      request: {
        body: {
          content: {
            'application/json': {
              schema: ModFilterQuery.extend({
                items: z.array(z.object({ ref: z.union([z.string(), z.number()]).optional(), ...KeysShape })).min(1).max(fe.BATCH_MAX),
              }),
            },
          },
        },
      },
      responses: {
        200: json(
          z.object({
            results: z.array(
              z.object({
                ref: z.unknown(),
                game_id: z.string().nullable(),
                matched: z.object({ kind: z.string(), value: z.string() }).nullable(),
                mod_ids: z.array(z.string()),
              }),
            ),
            mods: z.record(z.string(), ModDto),
          }),
          'One result per item, same order',
        ),
        400: json(ErrorDto, 'Bad request'),
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const r = await fe.resolveFilter(db, body);
      if ('error' in r) return c.json({ error: r.error }, 400);
      return c.json(await fe.batchLookup(db, body.items, r.filter), 200);
    },
  );

  const UpdatesBody = ModFilterQuery.extend({
    installed: z.array(z.object({ mod_id: z.string(), version: z.string() })).min(1).max(fe.BATCH_MAX),
  });
  const UpdatesDto = z.object({
    items: z.array(z.object({ mod_id: z.string(), installed: z.string(), latest: ReleaseDto, install: ModDto.shape.install })),
  });
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/updates',
      tags: ['emulators'],
      summary: 'Which installed mods have a newer compatible release',
      request: { body: { content: { 'application/json': { schema: UpdatesBody } } } },
      responses: { 200: json(UpdatesDto, 'Only mods with an update'), 400: json(ErrorDto, 'Bad request') },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const r = await fe.resolveFilter(db, body);
      if ('error' in r) return c.json({ error: r.error }, 400);
      return c.json({ items: (await fe.updatesFor(db, body.installed, r.filter)) as z.infer<typeof UpdatesDto>['items'] }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/updates',
      tags: ['emulators'],
      summary: 'Same as POST /v1/updates, with installed=mod@version,mod@version',
      request: { query: ModFilterQuery.extend({ installed: z.string().openapi({ example: 'tmc-android-dual-screen@1.1' }) }) },
      responses: { 200: json(UpdatesDto, 'Only mods with an update'), 400: json(ErrorDto, 'Bad request') },
    }),
    async (c) => {
      const query = c.req.valid('query');
      const r = await fe.resolveFilter(db, query);
      if ('error' in r) return c.json({ error: r.error }, 400);
      const items = await fe.updatesFor(db, fe.parseInstalled(query.installed), r.filter);
      return c.json({ items: items as z.infer<typeof UpdatesDto>['items'] }, 200);
    },
  );

  // Every key of every game that has mods: a frontend checks its library offline and refreshes with If-None-Match
  let compactCache: { body: string; etag: string; at: number } | null = null;
  app.get('/v1/index/compact.json', async (c) => {
    if (!compactCache || Date.now() - compactCache.at > 60_000) {
      const data = await fe.compactIndex(db);
      const body = JSON.stringify(data);
      compactCache = { body, etag: fe.etag(body), at: Date.now() };
    }
    c.header('ETag', compactCache.etag);
    c.header('Cache-Control', 'public, max-age=300');
    if (c.req.header('if-none-match') === compactCache.etag) return c.body(null, 304);
    return c.body(compactCache.body, 200, { 'Content-Type': 'application/json' });
  });

  const siteUrl = opts.siteUrl ?? 'http://localhost:3000';
  app.get('/v1/feed.atom', async (c) => {
    const items = await fe.feedItems(db, siteUrl, { game: c.req.query('game'), type: c.req.query('type'), device: c.req.query('device') });
    c.header('Cache-Control', 'public, max-age=600');
    return c.body(fe.atom(items, c.req.url, siteUrl), 200, { 'Content-Type': 'application/atom+xml; charset=utf-8' });
  });
  app.get('/v1/feed.json', async (c) => {
    const items = await fe.feedItems(db, siteUrl, { game: c.req.query('game'), type: c.req.query('type'), device: c.req.query('device') });
    c.header('Cache-Control', 'public, max-age=600');
    return c.body(JSON.stringify(fe.jsonFeed(items, c.req.url, siteUrl)), 200, { 'Content-Type': 'application/feed+json' });
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/games',
      tags: ['catalog'],
      summary: 'Search games',
      request: {
        query: z.object({
          q: z.string().optional(),
          platform: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
      responses: { 200: json(page(GameDto), 'Games'), 400: json(ErrorDto, 'Unknown platform') },
    }),
    async (c) => {
      const query = c.req.valid('query');
      const platform = query.platform ? await q.resolvePlatform(db, query.platform) : undefined;
      if (query.platform && !platform) return c.json({ error: `unknown platform "${query.platform}"` }, 400);
      return c.json(await q.listGames(db, { ...query, platform: platform ?? undefined }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/games/{id}',
      tags: ['catalog'],
      summary: 'Get a game',
      request: { params: Id },
      responses: { 200: json(GameDto, 'Game'), ...notFound },
    }),
    async (c) => {
      const g = await q.getGame(db, c.req.valid('param').id);
      return g ? c.json(g, 200) : c.json({ error: 'not found' }, 404);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/mods',
      tags: ['catalog'],
      summary: 'List mods',
      request: {
        query: ModFilterQuery.extend({
          game: z.string().optional(),
          q: z.string().optional(),
          sort: z.enum(['recent', 'popular']).optional().openapi({ description: 'recent (default): latest release first; popular: installs in the last 30 days' }),
        }),
      },
      responses: { 200: json(z.object({ items: z.array(ModDto) }), 'Mods'), 400: json(ErrorDto, 'Unknown platform') },
    }),
    async (c) => {
      const f = c.req.valid('query');
      const r = await fe.resolveFilter(db, f);
      if ('error' in r) return c.json({ error: r.error }, 400);
      const items = await q.listMods(db, { ...r.filter, gameId: f.game, q: f.q, sort: f.sort });
      return c.json({ items }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/mods/{id}',
      tags: ['catalog'],
      summary: 'Get a mod with targets, install steps and latest release',
      request: { params: Id },
      responses: { 200: json(ModDto, 'Mod'), ...notFound },
    }),
    async (c) => {
      const m = await q.getMod(db, c.req.valid('param').id);
      return m ? c.json(m, 200) : c.json({ error: 'not found' }, 404);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/mods/{id}/releases',
      tags: ['catalog'],
      summary: 'All known releases of a mod, newest first',
      request: { params: Id },
      responses: { 200: json(z.object({ items: z.array(ReleaseDto) }), 'Releases'), ...notFound },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      if (!(await q.getMod(db, id))) return c.json({ error: 'not found' }, 404);
      return c.json({ items: await q.getReleases(db, id) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/mods/{id}/releases/latest',
      tags: ['emulators'],
      summary: 'Latest release: download URLs, sizes, sha256 and install steps',
      request: { params: Id },
      responses: {
        200: json(ReleaseDto.extend({ mod_id: z.string(), install: ModDto.shape.install }), 'Latest release'),
        ...notFound,
      },
    }),
    async (c) => {
      const m = await q.getMod(db, c.req.valid('param').id);
      if (!m?.latest_release) return c.json({ error: 'no release yet' }, 404);
      return c.json({ ...m.latest_release, mod_id: m.id, install: m.install }, 200);
    },
  );

  const listRoute = <T extends z.ZodTypeAny>(path: string, schema: T, summary: string) =>
    createRoute({
      method: 'get',
      path,
      tags: ['catalog'],
      summary,
      responses: { 200: json(z.object({ items: z.array(schema) }), summary) },
    });
  app.openapi(listRoute('/v1/platforms', PlatformDto, 'Platforms'), async (c) =>
    c.json({ items: (await q.catalog(db)).platforms }, 200),
  );
  app.openapi(listRoute('/v1/emulators', EmulatorDto, 'Emulators, mod loaders and frontends'), async (c) =>
    c.json({ items: (await q.catalog(db)).emulators }, 200),
  );
  app.openapi(listRoute('/v1/devices', DeviceDto, 'Dual-screen devices'), async (c) =>
    c.json({ items: (await q.catalog(db)).devices }, 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/devices/{id}',
      tags: ['catalog'],
      summary: 'A device: screens, recommended emulator settings, mods and player reports',
      request: { params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'ayn-thor' }) }) },
      responses: { 200: json(DeviceDetailDto, 'Device'), ...notFound },
    }),
    async (c) => {
      const d = await q.getDevice(db, c.req.valid('param').id);
      return d ? c.json(d, 200) : c.json({ error: 'not found' }, 404);
    },
  );

  // Whole catalog in one document, for clients that prefer an offline cache. Revalidate with If-None-Match.
  let indexCache: { body: string; etag: string; at: number } | null = null;
  app.get('/v1/index.json', async (c) => {
    if (!indexCache || Date.now() - indexCache.at > 60_000) {
      const { generated_at, ...data } = await q.fullIndex(db);
      const content = JSON.stringify(data);
      const etag = etagFor(content);
      if (indexCache?.etag !== etag) {
        indexCache = { body: JSON.stringify({ generated_at, ...data }), etag, at: Date.now() };
      } else indexCache.at = Date.now();
    }
    c.header('ETag', indexCache.etag);
    c.header('Cache-Control', 'public, max-age=300');
    if (c.req.header('if-none-match') === indexCache.etag) return c.body(null, 304);
    return c.body(indexCache.body, 200, { 'Content-Type': 'application/json' });
  });

  app.get('/v1/status', async (c) => {
    const run = await q.lastSync(db);
    return c.json({
      last_sync: run && { started_at: run.startedAt, finished_at: run.finishedAt, status: run.status, stats: run.stats },
    });
  });

  // Called by the registry's GitHub Action after a merge; the worker picks the flag up within a minute.
  app.post('/admin/sync', async (c) => {
    const token = c.req.header('authorization')?.replace(/^Bearer /, '') ?? '';
    const expected = opts.adminToken ?? '';
    const ok =
      expected.length > 0 && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!ok) return c.json({ error: 'unauthorized' }, 401);
    const value = { v: Date.now() };
    await db
      .insert(syncState)
      .values({ key: 'sync_requested_at', value })
      .onConflictDoUpdate({ target: syncState.key, set: { value, updatedAt: new Date() } });
    return c.json({ requested: true }, 202);
  });

  app.doc31('/v1/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'DSG — Dual Screen Gamer API',
      version: '1.0.0',
      description:
        'API for emulators and frontends to discover and download dual-screen mods and texture packs. ' +
        'DSG never hosts files: download URLs point to the authors\' GitHub releases. Always verify sha256 when present.',
    },
    servers: opts.publicUrl ? [{ url: opts.publicUrl }] : undefined,
  });
  app.get('/v1/docs', Scalar({ url: '/v1/openapi.json', pageTitle: 'DSG API' }));

  app.route('/v1', reportRoutes(db));
  app.route('/v1', installRoutes(db, { salt: opts.installSalt ?? randomBytes(32).toString('hex'), trustProxy: opts.trustProxy ?? false }));
  app.route('/', accountRoutes(db, { publicUrl: opts.publicUrl, ...opts.account }));

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal error' }, 500);
  });

  return app;
}
