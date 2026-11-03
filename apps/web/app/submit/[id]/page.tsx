import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SubmitForm } from '@/components/submit/SubmitForm';
import type { Submission } from '@/lib/api';
import { formCatalog } from '@/lib/form-data';
import { apiJson, getMe } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit submission' };

type Props = { params: Promise<{ id: string }> };

export default async function EditSubmission({ params }: Props) {
  const { id } = await params;
  const me = await getMe();
  if (!me) redirect(`/login?next=/submit/${id}`);
  const sub = await apiJson<Submission & { payload: unknown }>(`/v1/me/submissions/${encodeURIComponent(id)}`);
  if (!sub) notFound();
  const t = await getTranslations('form');
  return (
    <article className="doc doc-wide">
      <header className="page-head page-head-doc">
        <h1>{sub.name || t('titleNew')}</h1>
        {sub.mod_id ? <p className="lead">{t('editingLead')}</p> : null}
      </header>
      <SubmitForm
        id={sub.id}
        status={sub.status}
        reviewNote={sub.review_note}
        initial={sub.payload}
        editingModId={sub.mod_id}
        me={me}
        {...await formCatalog()}
      />
    </article>
  );
}
