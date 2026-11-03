// Routes for signed-in users and moderators. Called by the website on behalf of the browser.
import { mods, platforms, sessions, submissions, users, type Db } from '@dsg/db';
import { fetchDat, indexDat, type DatGame } from '@dsg/romdb';
import { normalizeIdentifier, SUBMISSION_STATUSES } from '@dsg/schema';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  bearer,
  createSession,
  fetchProfile,
  hashToken,
  isModerator,
  newId,
  requireModerator,
  requireUser,
  safeEqual,
  upsertUser,
  type AdminList,
  type OAuthConfig,
  type Provider,
  type User,
} from './auth.ts';
import * as q from './queries.ts';
import { publishSubmission, validateSubmission, type Submission } from './submissions.ts';
import { mediaUrl, readMedia, storeUpload, UploadError } from './uploads.ts';

export type AccountOptions = {
  oauth?: OAuthConfig;
  admins?: AdminList;
  /** Shared secret between the website and the API */
  internalToken?: string;
  uploadDir?: string;
  uploadMaxBytes?: number;
  publicUrl?: string;
  /** Website base URL, for links in announcements */
  siteUrl?: string;
  fetch?: typeof fetch;
};

const MAX_PAYLOAD = 200_000;

type Env = { Variables: { user: User } };

function publicUser(u: User) {
  return { id: u.id, display_name: u.displayName, avatar_url: u.avatarUrl, role: u.role };
}

function submissionDto(s: Submission) {
  const p = s.payload as { mod?: { name?: string; type?: string }; game?: { existing?: string; new?: { title?: string } } };
  return {
    id: s.id,
    status: s.status,
    mod_id: s.modId,
    name: p.mod?.name ?? null,
    type: p.mod?.type ?? null,
    game: p.game?.existing ?? p.game?.new?.title ?? null,
    review_note: s.reviewNote,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
    submitted_at: s.submittedAt?.toISOString() ?? null,
    reviewed_at: s.reviewedAt?.toISOString() ?? null,
  };
}

/** DATs are big: keep one parsed copy per platform for a day. */
const datCache = new Map<string, { at: number; idx: Map<string, DatGame> }>();

export function accountRoutes(db: Db, opts: AccountOptions) {
  const app = new Hono<Env>();
  const uploadDir = opts.uploadDir ?? '/data/uploads';
  const publicUrl = opts.publicUrl ?? 'http://localhost:3001';
  const fetchImpl = opts.fetch ?? fetch;

  /* ---------- Sign-in (website only) ---------- */

  app.post('/internal/auth/oauth', async (c) => {
    if (!safeEqual(c.req.header('x-internal-token') ?? '', opts.internalToken ?? '')) return c.json({ error: 'forbidden' }, 403);
    const body = (await c.req.json().catch(() => null)) as { provider?: Provider; code?: string; redirect_uri?: string } | null;
    const provider = body?.provider;
    const cfg = provider ? opts.oauth?.[provider] : undefined;
    if (!provider || !cfg || !body?.code || !body.redirect_uri) return c.json({ error: 'unknown provider or missing code' }, 400);
    try {
      const profile = await fetchProfile(provider, cfg, body.code, body.redirect_uri, fetchImpl);
      const user = await upsertUser(db, provider, profile, opts.admins ?? {});
      if (user.banned) return c.json({ error: 'this account is suspended' }, 403);
      const session = await createSession(db, user.id);
      return c.json({ token: session.token, expires_at: session.expiresAt.toISOString(), user: publicUser(user) });
    } catch (e) {
      return c.json({ error: `sign-in failed: ${(e as Error).message}` }, 502);
    }
  });

  app.get('/internal/auth/providers', (c) =>
    c.json({ providers: (['github', 'discord'] as const).filter((p) => opts.oauth?.[p]?.clientId) }),
  );

  /* ---------- Media ---------- */

  app.get('/media/:file', async (c) => {
    const data = await readMedia(uploadDir, c.req.param('file'));
    if (!data) return c.json({ error: 'not found' }, 404);
    return c.body(new Uint8Array(data), 200, {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    });
  });

  /* ---------- Me ---------- */

  const me = new Hono<Env>();
  // Scoped to these paths: a catch-all here would also guard public /v1 routes registered later
  for (const path of ['/me', '/me/*', '/uploads']) me.use(path, requireUser(db));

  me.get('/me', (c) => c.json(publicUser(c.get('user'))));

  me.delete('/me/session', async (c) => {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(bearer(c)!)));
    return c.body(null, 204);
  });

  me.post('/uploads', async (c) => {
    const form = await c.req.parseBody().catch(() => null);
    const file = form?.file;
    if (!(file instanceof File)) return c.json({ error: 'send the image as the "file" field' }, 400);
    try {
      const r = await storeUpload(db, c.get('user').id, file, uploadDir, opts.uploadMaxBytes ?? 10 * 1048576);
      return c.json({ ...r, url: mediaUrl(publicUrl, r.sha256), thumb_url: mediaUrl(publicUrl, r.sha256, true) }, 201);
    } catch (e) {
      if (e instanceof UploadError) return c.json({ error: e.message }, e.status);
      throw e;
    }
  });

  /** Helps the form: is this dump already known, and what does the No-Intro/Redump DAT call it? */
  me.get('/me/rom-info', async (c) => {
    const platform = c.req.query('platform') ?? '';
    const keys = (['sha1', 'md5', 'crc32'] as const)
      .filter((k) => c.req.query(k))
      .map((k) => ({ kind: k, value: normalizeIdentifier(k, c.req.query(k)!) }));
    if (!keys.length) return c.json({ error: 'send sha1, md5 or crc32' }, 400);
    const known = await q.findGame(db, { identifiers: keys }, platform || undefined);
    const game = known ? await q.getGame(db, known.gameId) : null;
    let dat: { name: string; region: string | null; serial: string | null } | null = null;
    const [p] = platform ? await db.select().from(platforms).where(eq(platforms.id, platform)) : [];
    if (p?.externalIds.libretro && p.externalIds.libretroDat) {
      const key = p.id;
      let cached = datCache.get(key);
      if (!cached || Date.now() - cached.at > 86_400_000) {
        try {
          const list = await fetchDat(fetchImpl, { system: p.externalIds.libretro, dat: p.externalIds.libretroDat });
          cached = { at: Date.now(), idx: indexDat(list) };
          datCache.set(key, cached);
        } catch {
          cached = undefined;
        }
      }
      const hit = cached && keys.map((k) => cached!.idx.get(`${k.kind}:${k.value}`)).find(Boolean);
      if (hit) dat = { name: hit.name, region: hit.region ?? null, serial: hit.serial ?? hit.roms[0]?.serial ?? null };
    }
    return c.json({ game: game ? { id: game.id, title: game.title } : null, dat });
  });

  me.get('/me/submissions', async (c) => {
    const rows = await db.select().from(submissions).where(eq(submissions.userId, c.get('user').id)).orderBy(desc(submissions.updatedAt));
    return c.json({ items: rows.map(submissionDto) });
  });

  /** Mods this user owns (to offer "edit"). */
  me.get('/me/mods', async (c) => {
    const rows = await db.select({ id: mods.id, name: mods.name, published: mods.published }).from(mods).where(eq(mods.ownerUserId, c.get('user').id));
    return c.json({ items: rows });
  });

  async function own(c: { get: (k: 'user') => User }, id: string) {
    const [s] = await db.select().from(submissions).where(eq(submissions.id, id));
    if (!s) return null;
    return s.userId === c.get('user').id || isModerator(c.get('user')) ? s : null;
  }

  me.post('/me/submissions', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { payload?: unknown; mod_id?: string } | null;
    const raw = JSON.stringify(body?.payload ?? {});
    if (raw.length > MAX_PAYLOAD) return c.json({ error: 'submission too large' }, 413);
    const user = c.get('user');
    let payload: unknown = body?.payload ?? {};
    if (body?.mod_id) {
      // Editing: start from what was approved last
      const [m] = await db.select().from(mods).where(eq(mods.id, body.mod_id));
      if (!m || m.origin !== 'community' || (m.ownerUserId !== user.id && !isModerator(user))) return c.json({ error: 'you cannot edit this mod' }, 403);
      const [last] = await db
        .select()
        .from(submissions)
        .where(and(eq(submissions.modId, m.id), eq(submissions.status, 'approved')))
        .orderBy(desc(submissions.reviewedAt))
        .limit(1);
      if (!body.payload && last) payload = last.payload;
    }
    const [s] = await db
      .insert(submissions)
      .values({ id: newId(), userId: user.id, modId: body?.mod_id ?? null, payload })
      .returning();
    return c.json({ ...submissionDto(s!), payload: s!.payload }, 201);
  });

  me.get('/me/submissions/:id', async (c) => {
    const s = await own(c, c.req.param('id'));
    return s ? c.json({ ...submissionDto(s), payload: s.payload }) : c.json({ error: 'not found' }, 404);
  });

  me.patch('/me/submissions/:id', async (c) => {
    const s = await own(c, c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    if (s.status === 'pending' || s.status === 'approved') return c.json({ error: `a ${s.status} submission cannot be changed` }, 409);
    const body = (await c.req.json().catch(() => null)) as { payload?: unknown } | null;
    if (JSON.stringify(body?.payload ?? {}).length > MAX_PAYLOAD) return c.json({ error: 'submission too large' }, 413);
    const [u] = await db
      .update(submissions)
      .set({ payload: body?.payload ?? {}, status: 'draft', updatedAt: new Date() })
      .where(eq(submissions.id, s.id))
      .returning();
    return c.json({ ...submissionDto(u!), payload: u!.payload });
  });

  me.delete('/me/submissions/:id', async (c) => {
    const s = await own(c, c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    if (s.status === 'approved') return c.json({ error: 'approved submissions are kept as history' }, 409);
    await db.delete(submissions).where(eq(submissions.id, s.id));
    return c.body(null, 204);
  });

  /** Full validation without changing anything: the form calls it before the last step. */
  me.post('/me/submissions/:id/check', async (c) => {
    const s = await own(c, c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    const v = await validateSubmission(db, s.payload, c.get('user'), s.modId);
    return c.json(v.ok ? { ok: true, errors: [] } : { ok: false, errors: v.errors });
  });

  me.post('/me/submissions/:id/submit', async (c) => {
    const s = await own(c, c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    if (s.status === 'pending' || s.status === 'approved') return c.json({ error: `already ${s.status}` }, 409);
    const v = await validateSubmission(db, s.payload, c.get('user'), s.modId);
    if (!v.ok) return c.json({ error: 'the submission has problems', errors: v.errors }, 422);
    const [u] = await db
      .update(submissions)
      .set({ payload: v.data, status: 'pending', submittedAt: new Date(), updatedAt: new Date(), reviewNote: null })
      .where(eq(submissions.id, s.id))
      .returning();
    return c.json(submissionDto(u!));
  });

  /* ---------- Moderation ---------- */

  const admin = new Hono<Env>();
  admin.use('*', requireModerator(db));

  admin.get('/submissions', async (c) => {
    const status = c.req.query('status') ?? 'pending';
    if (!(SUBMISSION_STATUSES as readonly string[]).includes(status)) return c.json({ error: 'unknown status' }, 400);
    const rows = await db
      .select({ s: submissions, user: users })
      .from(submissions)
      .innerJoin(users, eq(users.id, submissions.userId))
      .where(eq(submissions.status, status))
      .orderBy(desc(submissions.submittedAt));
    return c.json({ items: rows.map((r) => ({ ...submissionDto(r.s), user: publicUser(r.user) })) });
  });

  admin.get('/submissions/:id', async (c) => {
    const [row] = await db
      .select({ s: submissions, user: users })
      .from(submissions)
      .innerJoin(users, eq(users.id, submissions.userId))
      .where(eq(submissions.id, c.req.param('id')));
    if (!row) return c.json({ error: 'not found' }, 404);
    const current = row.s.modId ? await q.getMod(db, row.s.modId, { includeUnpublished: true }) : null;
    const v = await validateSubmission(db, row.s.payload, row.user, row.s.modId);
    return c.json({ ...submissionDto(row.s), payload: row.s.payload, user: publicUser(row.user), current, problems: v.ok ? [] : v.errors });
  });

  admin.post('/submissions/:id/approve', async (c) => {
    const [row] = await db
      .select({ s: submissions, user: users })
      .from(submissions)
      .innerJoin(users, eq(users.id, submissions.userId))
      .where(eq(submissions.id, c.req.param('id')));
    if (!row) return c.json({ error: 'not found' }, 404);
    if (row.s.status !== 'pending') return c.json({ error: `submission is ${row.s.status}` }, 409);
    const v = await validateSubmission(db, row.s.payload, row.user, row.s.modId);
    if (!v.ok) return c.json({ error: 'the submission has problems', errors: v.errors }, 422);
    const modId = await publishSubmission(db, row.s, v.data, publicUrl, opts.siteUrl);
    const [u] = await db
      .update(submissions)
      .set({ status: 'approved', modId, reviewerId: c.get('user').id, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(submissions.id, row.s.id))
      .returning();
    return c.json(submissionDto(u!));
  });

  for (const [action, status] of [
    ['reject', 'rejected'],
    ['request-changes', 'changes_requested'],
  ] as const) {
    admin.post(`/submissions/:id/${action}`, async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { note?: string };
      const note = body.note?.trim().slice(0, 2000);
      if (!note) return c.json({ error: 'write a note for the author' }, 400);
      const [u] = await db
        .update(submissions)
        .set({ status, reviewNote: note, reviewerId: c.get('user').id, reviewedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(submissions.id, c.req.param('id')), eq(submissions.status, 'pending')))
        .returning();
      return u ? c.json(submissionDto(u)) : c.json({ error: 'not a pending submission' }, 409);
    });
  }

  admin.post('/mods/:id/published', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { published?: boolean };
    if (typeof body.published !== 'boolean') return c.json({ error: 'send { "published": true|false }' }, 400);
    const [m] = await db.update(mods).set({ published: body.published }).where(eq(mods.id, c.req.param('id'))).returning({ id: mods.id });
    return m ? c.json({ id: m.id, published: body.published }) : c.json({ error: 'not found' }, 404);
  });

  admin.post('/users/:id/banned', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { banned?: boolean };
    if (typeof body.banned !== 'boolean') return c.json({ error: 'send { "banned": true|false }' }, 400);
    const [u] = await db.update(users).set({ banned: body.banned }).where(eq(users.id, c.req.param('id'))).returning();
    if (!u) return c.json({ error: 'not found' }, 404);
    if (body.banned) {
      await db.delete(sessions).where(eq(sessions.userId, u.id));
      // A banned user's mods disappear until a moderator decides otherwise
      await db.update(mods).set({ published: false }).where(eq(mods.ownerUserId, u.id));
    }
    return c.json(publicUser(u));
  });

  app.route('/v1', me);
  app.route('/v1/admin', admin);
  return app;
}

