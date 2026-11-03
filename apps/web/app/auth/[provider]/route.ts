import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { PROVIDERS, safeReturnTo, SITE_URL, STATE_COOKIE, type ProviderId } from '@/lib/session';

/** Starts OAuth: remembers a random state (and where to go back) in a short-lived cookie. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const provider = (await ctx.params).provider as ProviderId;
  const p = PROVIDERS[provider];
  if (!p?.clientId) return NextResponse.redirect(`${SITE_URL}/login?error=provider`);
  const state = randomBytes(16).toString('base64url');
  const url = new URL(p.authorize);
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', `${SITE_URL}/auth/callback/${provider}`);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  if (p.scope) url.searchParams.set('scope', p.scope);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, `${state}|${safeReturnTo(req.nextUrl.searchParams.get('next'))}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: SITE_URL.startsWith('https://'),
    maxAge: 600,
    path: '/auth',
  });
  return res;
}
