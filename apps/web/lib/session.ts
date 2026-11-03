// Server-only: the visitor's session lives in an httpOnly cookie; calls to the API carry it as a Bearer token.
import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';

export const SESSION_COOKIE = 'dsg_session';
export const STATE_COOKIE = 'dsg_oauth_state';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
export const SITE_URL = (process.env.PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export type Me = { id: string; display_name: string; avatar_url: string | null; role: 'user' | 'moderator' | 'admin' };

/** Calls the API as the website (internal token) and, when signed in, as the visitor. */
export async function apiFetch(path: string, init: RequestInit = {}, token?: string | null): Promise<Response> {
  const t = token === undefined ? (await cookies()).get(SESSION_COOKIE)?.value : token;
  const headers = new Headers(init.headers);
  headers.set('User-Agent', 'dsg-web');
  headers.set('x-internal-token', process.env.INTERNAL_TOKEN ?? '');
  if (t) headers.set('Authorization', `Bearer ${t}`);
  return fetch(`${API}${path}`, { ...init, headers, cache: 'no-store' });
}

export const getMe = cache(async (): Promise<Me | null> => {
  if (!(await cookies()).get(SESSION_COOKIE)) return null;
  const res = await apiFetch('/v1/me');
  return res.ok ? ((await res.json()) as Me) : null;
});

export async function apiJson<T>(path: string): Promise<T | null> {
  const res = await apiFetch(path);
  return res.ok ? ((await res.json()) as T) : null;
}

export const isModerator = (me: Me | null) => me?.role === 'moderator' || me?.role === 'admin';

/** OAuth apps configured for the website (client ids are public, secrets stay in the API). */
export const PROVIDERS = {
  github: {
    clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
    authorize: 'https://github.com/login/oauth/authorize',
    scope: '',
  },
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID,
    authorize: 'https://discord.com/oauth2/authorize',
    scope: 'identify',
  },
} as const;
export type ProviderId = keyof typeof PROVIDERS;
export const enabledProviders = () => (Object.keys(PROVIDERS) as ProviderId[]).filter((p) => PROVIDERS[p].clientId);

/** Only same-site relative paths are accepted as a post-login destination. */
export function safeReturnTo(v: string | null | undefined): string {
  return v && /^\/(?!\/)[\w\-./?=&%#]*$/.test(v) ? v : '/account';
}
