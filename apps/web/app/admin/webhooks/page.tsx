import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { WebhookManager, type HookRow } from '@/components/WebhookManager';
import { api, MOD_TYPES } from '@/lib/api';
import { apiJson, getMe } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Webhooks' };

export default async function Webhooks() {
  const me = await getMe();
  if (!me) redirect('/login?next=/admin/webhooks');
  if (me.role !== 'admin') notFound();
  const [t, tt, data, index] = await Promise.all([
    getTranslations('webhooks'),
    getTranslations('types'),
    apiJson<{ items: HookRow[] }>('/v1/admin/webhooks'),
    api.index(),
  ]);
  return (
    <article className="doc">
      <nav className="crumbs">
        <Link href="/admin">{t('back')}</Link>
      </nav>
      <header className="page-head page-head-doc">
        <h1>{t('title')}</h1>
        <p className="lead">{t('lead')}</p>
      </header>
      <WebhookManager
        items={data?.items ?? []}
        types={MOD_TYPES.map((x) => ({ id: x, name: tt(x) }))}
        devices={index.devices.map((d) => ({ id: d.id, name: d.name }))}
      />
    </article>
  );
}
