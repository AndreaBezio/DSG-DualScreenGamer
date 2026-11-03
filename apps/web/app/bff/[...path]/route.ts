// Same-origin bridge from the browser to the API's account endpoints: the session cookie
// never leaves this site, and the API sees the visitor's Bearer token.
import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch, SITE_URL } from '@/lib/session';

const ALLOWED = /^(me(\/.*)?|uploads|admin\/.+)$/;

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join('/');
  if (!ALLOWED.test(path)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  // Writes must come from our own pages
  if (req.method !== 'GET' && req.headers.get('origin') !== new URL(SITE_URL).origin) {
    return NextResponse.json({ error: 'bad origin' }, { status: 403 });
  }
  const headers: Record<string, string> = {};
  const type = req.headers.get('content-type');
  if (type) headers['content-type'] = type;
  const res = await apiFetch(`/v1/${path}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
  });
  return new NextResponse(res.status === 204 ? null : await res.arrayBuffer(), {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
}

export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
