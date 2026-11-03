import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch, PROVIDERS, safeReturnTo, SESSION_COOKIE, SITE_URL, STATE_COOKIE, type ProviderId } from '@/lib/session';

/** Finishes OAuth: checks the state, lets the API exchange the code, stores the session cookie. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const provider = (await ctx.params).provider as ProviderId;
  const [state, next] = (req.cookies.get(STATE_COOKIE)?.value ?? '').split('|');
  const code = req.nextUrl.searchParams.get('code');
  const fail = (reason: string) => {
    const r = NextResponse.redirect(`${SITE_URL}/login?error=${reason}`);
    r.cookies.delete({ name: STATE_COOKIE, path: '/auth' });
    return r;
  };
  if (!PROVIDERS[provider] || !code || !state || state !== req.nextUrl.searchParams.get('state')) return fail('state');

  const res = await apiFetch(
    '/internal/auth/oauth',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, code, redirect_uri: `${SITE_URL}/auth/callback/${provider}` }),
    },
    null,
  );
  if (res.status === 403) return fail('suspended');
  if (!res.ok) return fail('failed');
  const { token, expires_at } = (await res.json()) as { token: string; expires_at: string };
  const out = NextResponse.redirect(`${SITE_URL}${safeReturnTo(next)}`);
  out.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: SITE_URL.startsWith('https://'),
    expires: new Date(expires_at),
    path: '/',
  });
  out.cookies.delete({ name: STATE_COOKIE, path: '/auth' });
  return out;
}
