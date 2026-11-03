import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import type { Submission } from '@/lib/api';
import { apiJson, getMe, isModerator } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your account' };

export default async function Account() {
  const me = await getMe();
  if (!me) redirect('/login?next=/account');
  const [t, format, subs, mine] = await Promise.all([
    getTranslations('account'),
    getFormatter(),
    apiJson<{ items: Submission[] }>('/v1/me/submissions'),
    apiJson<{ items: { id: string; name: string; published: boolean }[] }>('/v1/me/mods'),
  ]);
  const tf = await getTranslations('form');

  return (
    <article className="doc">
      <header className="page-head">
        <div className="me">
          {me.avatar_url ? <img src={me.avatar_url} alt="" className="me-avatar" /> : null}
          <div>
            <h1>{me.display_name}</h1>
            <p className="muted">{t(`role.${me.role}`)}</p>
          </div>
        </div>
        <div className="row-actions">
          {isModerator(me) ? (
            <Link href="/admin" className="btn btn-ghost" data-nav>
              {t('moderation')}
            </Link>
          ) : null}
          <Link href="/submit/new" className="btn btn-primary" data-nav>
            <Icon name="plus" size={16} />
            {t('newMod')}
          </Link>
          <form action="/auth/logout" method="post">
            <button className="btn btn-ghost" data-nav>
              {t('signOut')}
            </button>
          </form>
        </div>
      </header>

      <section className="sheet">
        <h2>{t('submissions')}</h2>
        {subs?.items.length ? (
          <ul className="list">
            {subs.items.map((s) => (
              <li key={s.id}>
                <Link href={`/submit/${s.id}`} className="row" data-nav>
                  <span className="row-main">
                    <strong>{s.name || t('untitled')}</strong>
                    <span>
                      {s.game ?? ''} · {format.dateTime(new Date(s.updated_at), { dateStyle: 'medium' })}
                    </span>
                    {s.review_note && s.status !== 'approved' ? <span className="review-note">{s.review_note}</span> : null}
                  </span>
                  <span className={`status status-${s.status}`}>{tf(`status.${s.status}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t('noSubmissions')}</p>
        )}
      </section>

      {mine?.items.length ? (
        <section className="sheet">
          <h2>{t('yourMods')}</h2>
          <ul className="list">
            {mine.items.map((m) => (
              <li key={m.id} className="row">
                <span className="row-main">
                  <Link href={`/mods/${m.id}`}>{m.name}</Link>
                  {!m.published ? <span className="muted">{t('hidden')}</span> : null}
                </span>
                <form action="/submit/edit" method="post">
                  <input type="hidden" name="mod" value={m.id} />
                  <button className="btn btn-ghost btn-sm">{t('edit')}</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
