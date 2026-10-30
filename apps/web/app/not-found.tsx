import { getTranslations } from 'next-intl/server';
import { Console } from '@/components/Console';

export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <Console
      top={
        <div className="welcome">
          <h1>{t('title')}</h1>
          <p>{t('body')}</p>
        </div>
      }
      bottom={<div className="panel" />}
      back="/"
    />
  );
}
