// Accounts: OAuth with GitHub and Discord, opaque session tokens, roles.
// The website runs the browser side of OAuth and calls POST /internal/auth/oauth with the code;
// it then keeps the session token in its own httpOnly cookie and forwards it as a Bearer token.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sessions, userAccounts, users, type Db } from '@dsg/db';
import { and, eq, gt } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';

export type Provider = 'github' | 'discord';
export type OAuthConfig = Partial<Record<Provider, { clientId: string; clientSecret: string }>>;
export type AdminList = Partial<Record<Provider, string[]>>;
export type User = typeof users.$inferSelect;

const SESSION_DAYS = 30;

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const newId = () => randomBytes(12).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  return a.length > 0 && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

type ProviderProfile = { id: string; username: string; displayName: string; avatarUrl: string | null };

/** Exchanges an authorization code for the provider's user profile. */
export async function fetchProfile(
  provider: Provider,
  cfg: { clientId: string; clientSecret: string },
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderProfile> {
  if (provider === 'github') {
    const tokenRes = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: redirectUri }),
    });
    const token = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!token.access_token) throw new Error(`github: ${token.error ?? 'no access token'}`);
    const res = await fetchImpl('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dsg' },
    });
    if (!res.ok) throw new Error(`github user: HTTP ${res.status}`);
    const u = (await res.json()) as { id: number; login: string; name: string | null; avatar_url: string | null };
    return { id: String(u.id), username: u.login, displayName: u.name || u.login, avatarUrl: u.avatar_url };
  }
  const tokenRes = await fetchImpl('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  const token = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!token.access_token) throw new Error(`discord: ${token.error ?? 'no access token'}`);
  const res = await fetchImpl('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!res.ok) throw new Error(`discord user: HTTP ${res.status}`);
  const u = (await res.json()) as { id: string; username: string; global_name: string | null; avatar: string | null };
  return {
    id: u.id,
    username: u.username,
    displayName: u.global_name || u.username,
    avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null,
  };
}

/** Finds or creates the user behind a provider account, and promotes configured admins. */
export async function upsertUser(db: Db, provider: Provider, p: ProviderProfile, admins: AdminList): Promise<User> {
  const isAdmin =
    provider === 'github'
      ? (admins.github ?? []).some((l) => l.toLowerCase() === p.username.toLowerCase())
      : (admins.discord ?? []).includes(p.id);
  return db.transaction(async (tx) => {
    const [acct] = await tx
      .select()
      .from(userAccounts)
      .where(and(eq(userAccounts.provider, provider), eq(userAccounts.providerUserId, p.id)));
    if (acct) {
      await tx.update(userAccounts).set({ username: p.username }).where(eq(userAccounts.id, acct.id));
      const [u] = await tx
        .update(users)
        .set({ avatarUrl: p.avatarUrl, updatedAt: new Date(), ...(isAdmin ? { role: 'admin' } : {}) })
        .where(eq(users.id, acct.userId))
        .returning();
      return u!;
    }
    const [u] = await tx
      .insert(users)
      .values({ id: newId(), displayName: p.displayName, avatarUrl: p.avatarUrl, role: isAdmin ? 'admin' : 'user' })
      .returning();
    await tx.insert(userAccounts).values({ userId: u!.id, provider, providerUserId: p.id, username: p.username });
    return u!;
  });
}

export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function userFromToken(db: Db, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
  return row && !row.user.banned ? row.user : null;
}

export const bearer = (c: Context) => c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];

type Env = { Variables: { user: User } };

export function requireUser(db: Db): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = await userFromToken(db, bearer(c));
    if (!user) return c.json({ error: 'sign in required' }, 401);
    c.set('user', user);
    await next();
  };
}

export const isModerator = (u: User) => u.role === 'moderator' || u.role === 'admin';

export function requireModerator(db: Db): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = await userFromToken(db, bearer(c));
    if (!user) return c.json({ error: 'sign in required' }, 401);
    if (!isModerator(user)) return c.json({ error: 'moderators only' }, 403);
    c.set('user', user);
    await next();
  };
}

export function requireAdmin(db: Db): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = await userFromToken(db, bearer(c));
    if (!user) return c.json({ error: 'sign in required' }, 401);
    if (user.role !== 'admin') return c.json({ error: 'admins only' }, 403);
    c.set('user', user);
    await next();
  };
}
