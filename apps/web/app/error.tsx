'use client';

import { useTranslations } from 'next-intl';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('error');
  return (
    <section className="message">
      <h1>{t('api')}</h1>
      <button className="btn btn-primary" onClick={reset} data-nav>
        {t('retry')}
      </button>
    </section>
  );
}
