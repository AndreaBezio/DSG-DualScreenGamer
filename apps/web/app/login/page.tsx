import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { enabledProviders, getMe, safeReturnTo } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in' };

type Props = { searchParams: Promise<{ next?: string; error?: string }> };

export default async function Login({ searchParams }: Props) {
  const sp = await searchParams;
  const next = safeReturnTo(sp.next);
  if (await getMe()) redirect(next);
  const t = await getTranslations('login');
  const providers = enabledProviders();
  return (
    <section className="message login">
      <h1>{t('title')}</h1>
      <p className="lead">{t('lead')}</p>
      {sp.error ? <p className="notice notice-bad">{t(`error.${sp.error === 'suspended' ? 'suspended' : 'failed'}`)}</p> : null}
      <div className="login-buttons">
        {providers.includes('github') ? (
          <a href={`/auth/github?next=${encodeURIComponent(next)}`} className="btn btn-dark" data-nav>
            {t('github')}
          </a>
        ) : null}
        {providers.includes('discord') ? (
          <a href={`/auth/discord?next=${encodeURIComponent(next)}`} className="btn btn-discord" data-nav>
            {t('discord')}
          </a>
        ) : null}
        {!providers.length ? <p className="notice notice-warn">{t('none')}</p> : null}
      </div>
      <p className="fineprint">{t('privacy')}</p>
    </section>
  );
}
