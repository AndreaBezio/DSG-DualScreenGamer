import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch, SESSION_COOKIE, SITE_URL } from '@/lib/session';

export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== new URL(SITE_URL).origin) return new NextResponse('bad origin', { status: 403 });
  await apiFetch('/v1/me/session', { method: 'DELETE' }).catch(() => null);
  const res = NextResponse.redirect(`${SITE_URL}/`, 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
