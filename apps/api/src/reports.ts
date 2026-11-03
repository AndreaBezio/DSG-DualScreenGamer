// Compatibility reports: signed-in players say whether a mod works on their device.
import { compatReports, devices, emulators, modReleases, mods, users, type Db } from '@dsg/db';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireModerator, requireUser, type User } from './auth.ts';

export const RESULTS = ['works', 'issues', 'broken'] as const;
export type Result = (typeof RESULTS)[number];
export type CompatSummary = Record<Result, number> & { by_device: Record<string, Record<Result, number>> };

const PER_DAY = 30;

const ReportInput = z
  .object({
    mod_id: z.string().min(1),
    version: z.string().trim().min(1).max(40).optional(),
    device: z.string().min(1),
    firmware: z.string().trim().max(40).optional(),
    emulator: z.string().optional(),
    emulator_version: z.string().trim().max(40).optional(),
    result: z.enum(RESULTS),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

const empty = (): Record<Result, number> => ({ works: 0, issues: 0, broken: 0 });

/** Visible reports: not hidden by a moderator, author not suspended. */
const visible = and(eq(compatReports.hidden, false), eq(users.banned, false));

/** Per-mod counts, for many mods in one query. */
export async function compatSummaries(db: Db, modIds: string[]): Promise<Map<string, CompatSummary>> {
  const out = new Map<string, CompatSummary>();
  if (!modIds.length) return out;
  const rows = await db
    .select({ modId: compatReports.modId, device: compatReports.device, result: compatReports.result, n: sql<number>`count(*)::int` })
    .from(compatReports)
    .innerJoin(users, eq(users.id, compatReports.userId))
    .where(and(inArray(compatReports.modId, modIds), visible))
    .groupBy(compatReports.modId, compatReports.device, compatReports.result);
  for (const r of rows) {
    const s = out.get(r.modId) ?? { ...empty(), by_device: {} };
    const result = r.result as Result;
    s[result] += r.n;
    (s.by_device[r.device] ??= empty())[result] += r.n;
    out.set(r.modId, s);
  }
  return out;
}

export const emptySummary = (): CompatSummary => ({ ...empty(), by_device: {} });

export async function latestReports(db: Db, modId: string, limit = 20) {
  const rows = await db
    .select({ r: compatReports, u: users })
    .from(compatReports)
    .innerJoin(users, eq(users.id, compatReports.userId))
    .where(and(eq(compatReports.modId, modId), visible))
    .orderBy(desc(compatReports.updatedAt))
    .limit(limit);
  return rows.map(({ r, u }) => ({
    id: r.id,
    version: r.version,
    device: r.device,
    firmware: r.firmware,
    emulator: r.emulator,
    emulator_version: r.emulatorVersion,
    result: r.result as Result,
    note: r.note,
    user: { display_name: u.displayName, avatar_url: u.avatarUrl },
    updated_at: r.updatedAt.toISOString(),
  }));
}

type Env = { Variables: { user: User } };

export function reportRoutes(db: Db) {
  const app = new Hono<Env>();

  app.get('/mods/:id/reports', async (c) => {
    const id = c.req.param('id');
    const [m] = await db.select({ id: mods.id }).from(mods).where(and(eq(mods.id, id), eq(mods.published, true)));
    if (!m) return c.json({ error: 'not found' }, 404);
    const [summary, items] = await Promise.all([compatSummaries(db, [id]), latestReports(db, id)]);
    return c.json({ summary: summary.get(id) ?? emptySummary(), items });
  });

  const me = new Hono<Env>();
  me.use('*', requireUser(db));

  me.post('/reports', async (c) => {
    const parsed = ReportInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    const r = parsed.data;
    const user = c.get('user');
    const [mod] = await db.select().from(mods).where(and(eq(mods.id, r.mod_id), eq(mods.published, true)));
    if (!mod) return c.json({ error: 'unknown mod' }, 404);
    const [dev] = await db.select({ id: devices.id }).from(devices).where(eq(devices.id, r.device));
    if (!dev) return c.json({ error: `unknown device "${r.device}"` }, 400);
    if (r.emulator) {
      const [emu] = await db.select({ id: emulators.id }).from(emulators).where(eq(emulators.id, r.emulator));
      if (!emu) return c.json({ error: `unknown emulator "${r.emulator}"` }, 400);
    }
    const [{ n }] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(compatReports)
      .where(and(eq(compatReports.userId, user.id), gt(compatReports.updatedAt, new Date(Date.now() - 86_400_000))))) as [{ n: number }];
    if (n >= PER_DAY) return c.json({ error: 'too many reports today' }, 429);
    // Reports are about a version: default to the latest one
    const [latest] = await db.select({ version: modReleases.version }).from(modReleases).where(eq(modReleases.modId, mod.id)).orderBy(desc(modReleases.publishedAt)).limit(1);
    const values = {
      modId: mod.id,
      userId: user.id,
      version: r.version ?? latest?.version ?? 'unknown',
      device: r.device,
      firmware: r.firmware ?? null,
      emulator: r.emulator ?? null,
      emulatorVersion: r.emulator_version ?? null,
      result: r.result,
      note: r.note ?? null,
    };
    const [row] = await db
      .insert(compatReports)
      .values(values)
      .onConflictDoUpdate({
        target: [compatReports.modId, compatReports.userId, compatReports.version, compatReports.device],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    return c.json({ id: row!.id, version: row!.version, result: row!.result }, 201);
  });

  me.delete('/reports/:id', async (c) => {
    const [row] = await db
      .delete(compatReports)
      .where(and(eq(compatReports.id, Number(c.req.param('id'))), eq(compatReports.userId, c.get('user').id)))
      .returning({ id: compatReports.id });
    return row ? c.body(null, 204) : c.json({ error: 'not found' }, 404);
  });

  me.get('/reports', async (c) => {
    const modId = c.req.query('mod');
    const rows = await db
      .select()
      .from(compatReports)
      .where(and(eq(compatReports.userId, c.get('user').id), modId ? eq(compatReports.modId, modId) : undefined))
      .orderBy(desc(compatReports.updatedAt));
    return c.json({ items: rows.map((r) => ({ id: r.id, mod_id: r.modId, version: r.version, device: r.device, result: r.result, note: r.note })) });
  });

  const admin = new Hono<Env>();
  admin.use('*', requireModerator(db));
  admin.post('/reports/:id/hidden', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { hidden?: boolean };
    if (typeof body.hidden !== 'boolean') return c.json({ error: 'send { "hidden": true|false }' }, 400);
    const [row] = await db
      .update(compatReports)
      .set({ hidden: body.hidden })
      .where(eq(compatReports.id, Number(c.req.param('id'))))
      .returning({ id: compatReports.id });
    return row ? c.json({ id: row.id, hidden: body.hidden }) : c.json({ error: 'not found' }, 404);
  });

  app.route('/me', me);
  app.route('/admin', admin);
  return app;
}
