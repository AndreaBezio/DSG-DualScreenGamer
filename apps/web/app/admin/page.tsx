import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { Submission } from '@/lib/api';
import { apiJson, getMe, isModerator } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Moderation' };

const TABS = ['pending', 'changes_requested', 'approved', 'rejected'] as const;

type Props = { searchParams: Promise<{ status?: string }> };

export default async function Admin({ searchParams }: Props) {
  const me = await getMe();
  if (!me) redirect('/login?next=/admin');
  if (!isModerator(me)) notFound();
  const wanted = (await searchParams).status;
  const status = TABS.find((s) => s === wanted) ?? 'pending';
  const [t, tf, format, data] = await Promise.all([
    getTranslations('admin'),
    getTranslations('form'),
    getFormatter(),
    apiJson<{ items: (Submission & { user: { display_name: string } })[] }>(`/v1/admin/submissions?status=${status}`),
  ]);
  return (
    <article className="doc">
      <header className="page-head">
        <h1>{t('title')}</h1>
        {me.role === 'admin' ? (
          <Link href="/admin/webhooks" className="btn btn-ghost" data-nav>
            {t('webhooks')}
          </Link>
        ) : null}
      </header>
      <nav className="chip-tabs">
        {TABS.map((s) => (
          <Link key={s} href={`/admin?status=${s}`} className={`chip-tab${s === status ? ' on' : ''}`} data-nav>
            {tf(`status.${s}`)}
          </Link>
        ))}
      </nav>
      <section className="sheet">
        {data?.items.length ? (
          <ul className="list">
            {data.items.map((s) => (
              <li key={s.id}>
                <Link href={`/admin/submissions/${s.id}`} className="row" data-nav>
                  <span className="row-main">
                    <strong>{s.name}</strong>
                    <span>
                      {s.game} · {s.user.display_name} · {s.submitted_at ? format.dateTime(new Date(s.submitted_at), { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                    </span>
                  </span>
                  {s.mod_id ? <span className="chip">{t('edit')}</span> : <span className="chip chip-strong">{t('new')}</span>}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t('empty')}</p>
        )}
      </section>
    </article>
  );
}
