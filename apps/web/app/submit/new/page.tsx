import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SubmitForm } from '@/components/submit/SubmitForm';
import { formCatalog } from '@/lib/form-data';
import { getMe } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Add a mod' };

export default async function NewSubmission() {
  const me = await getMe();
  if (!me) redirect('/login?next=/submit/new');
  const t = await getTranslations('form');
  return (
    <article className="doc doc-wide">
      <header className="page-head page-head-doc">
        <h1>{t('titleNew')}</h1>
        <p className="lead">{t('lead')}</p>
      </header>
      <SubmitForm id={null} status="draft" reviewNote={null} initial={null} editingModId={null} me={me} {...await formCatalog()} />
    </article>
  );
}
