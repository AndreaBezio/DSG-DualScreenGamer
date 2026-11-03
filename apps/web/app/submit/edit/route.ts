import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch, SITE_URL } from '@/lib/session';

/** Starts an edit of a published community mod: a new draft prefilled with the approved version. */
export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== new URL(SITE_URL).origin) return new NextResponse('bad origin', { status: 403 });
  const mod = (await req.formData()).get('mod');
  const res = await apiFetch('/v1/me/submissions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mod_id: String(mod ?? '') }),
  });
  if (!res.ok) return NextResponse.redirect(`${SITE_URL}/account`, 303);
  const { id } = (await res.json()) as { id: string };
  return NextResponse.redirect(`${SITE_URL}/submit/${id}`, 303);
}
