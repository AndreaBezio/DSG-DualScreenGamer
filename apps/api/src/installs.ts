// Anonymous install counter. A client is recognised for one day by an HMAC of its address and
// user agent under a key that changes daily, so nothing that identifies a person is kept.
import { createHmac } from 'node:crypto';
import { devices, installSeen, modInstallCounts, mods, type Db } from '@dsg/db';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { clientIp } from './rate-limit.ts';

export type InstallStats = { total: number; last_30_days: number };

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export async function installStats(db: Db, modIds: string[]): Promise<Map<string, InstallStats>> {
  const out = new Map<string, InstallStats>();
  if (!modIds.length) return out;
  const since = daysAgo(30);
  const rows = await db
    .select({
      modId: modInstallCounts.modId,
      total: sql<number>`sum(${modInstallCounts.count})::int`,
      recent: sql<number>`coalesce(sum(${modInstallCounts.count}) filter (where ${modInstallCounts.day} > ${since}), 0)::int`,
    })
    .from(modInstallCounts)
    .where(inArray(modInstallCounts.modId, modIds))
    .groupBy(modInstallCounts.modId);
  for (const r of rows) out.set(r.modId, { total: r.total, last_30_days: r.recent });
  return out;
}

/** SQL for ordering mods by installs in the last 30 days. */
export const popularity = () =>
  sql`(select coalesce(sum(c.count), 0) from mod_install_counts c where c.mod_id = ${mods.id} and c.day > ${daysAgo(30)})`;

export function installRoutes(db: Db, opts: { salt: string; trustProxy: boolean }) {
  const app = new Hono();
  let purgedFor = '';

  async function body(c: Context): Promise<{ version?: string; device?: string; emulator?: string }> {
    // navigator.sendBeacon posts text/plain: accept JSON either way
    try {
      const text = await c.req.text();
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  }

  app.post('/mods/:id/installs', async (c) => {
    const id = c.req.param('id');
    const [mod] = await db.select({ id: mods.id }).from(mods).where(and(eq(mods.id, id), eq(mods.published, true)));
    if (!mod) return c.json({ error: 'not found' }, 404);
    const b = await body(c);
    let device = typeof b.device === 'string' ? b.device : '';
    if (device) {
      const [d] = await db.select({ id: devices.id }).from(devices).where(eq(devices.id, device));
      device = d?.id ?? '';
    }
    const day = today();
    if (purgedFor !== day) {
      await db.delete(installSeen).where(lt(installSeen.day, day));
      purgedFor = day;
    }
    const dailyKey = createHmac('sha256', opts.salt).update(day).digest();
    const hash = createHmac('sha256', dailyKey)
      .update(`${clientIp(c, opts.trustProxy)}\n${c.req.header('user-agent') ?? ''}\n${mod.id}`)
      .digest('hex');
    const fresh = await db.insert(installSeen).values({ hash, day }).onConflictDoNothing().returning({ hash: installSeen.hash });
    if (!fresh.length) return c.json({ counted: false }, 202);
    await db
      .insert(modInstallCounts)
      .values({ modId: mod.id, day, device, count: 1 })
      .onConflictDoUpdate({
        target: [modInstallCounts.modId, modInstallCounts.day, modInstallCounts.device],
        set: { count: sql`${modInstallCounts.count} + 1` },
      });
    return c.json({ counted: true }, 202);
  });

  return app;
}

