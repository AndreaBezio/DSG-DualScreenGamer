'use client';

import { useTranslations } from 'next-intl';
import { Console } from '@/components/Console';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('error');
  return (
    <Console
      top={
        <div className="welcome">
          <h1>{t('api')}</h1>
          <button className="btn btn-primary" onClick={reset} data-nav>
            ↻
          </button>
        </div>
      }
      bottom={<div className="panel" />}
    />
  );
}
