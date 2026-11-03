import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

/** Fixed-window per-IP limiter. In memory: fine for a single API container. */
export function rateLimit(perMinute: number, trustProxy: boolean, skip?: (c: Context) => boolean): MiddlewareHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, 60_000).unref();

  return async (c, next) => {
    if (skip?.(c)) return next();
    let ip = trustProxy ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
    if (!ip) {
      try {
        ip = getConnInfo(c).remote.address;
      } catch {
        ip = 'unknown';
      }
    }
    const now = Date.now();
    let e = hits.get(ip ?? 'unknown');
    if (!e || e.reset < now) {
      e = { n: 0, reset: now + 60_000 };
      hits.set(ip ?? 'unknown', e);
    }
    e.n++;
    c.header('RateLimit-Limit', String(perMinute));
    c.header('RateLimit-Remaining', String(Math.max(0, perMinute - e.n)));
    if (e.n > perMinute) {
      c.header('Retry-After', String(Math.ceil((e.reset - now) / 1000)));
      return c.json({ error: 'rate limit exceeded' }, 429);
    }
    await next();
  };
}
