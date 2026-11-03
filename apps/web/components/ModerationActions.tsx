'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export function ModerationActions({ id, userId, modId }: { id: string; userId: string; modId: string | null }) {
  const t = useTranslations('admin');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string[] | null>(null);
  async function act(path: string, body?: object) {
    setError(null);
    const res = await fetch(`/bff/admin/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.errors ?? [json.error ?? 'error']);
    router.push('/admin');
    router.refresh();
  }
  return (
    <div className="sheet moderation">
      <h2>{t('decision')}</h2>
      <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} />
      <div className="row-actions">
        <button className="btn btn-primary" onClick={() => act(`submissions/${id}/approve`)} data-nav>
          {t('approve')}
        </button>
        <button className="btn btn-ghost" onClick={() => act(`submissions/${id}/request-changes`, { note })} data-nav>
          {t('requestChanges')}
        </button>
        <button className="btn btn-ghost btn-danger" onClick={() => act(`submissions/${id}/reject`, { note })} data-nav>
          {t('reject')}
        </button>
      </div>
      {error ? (
        <ul className="problems">
          {error.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary>{t('more')}</summary>
        <div className="row-actions">
          {modId ? (
            <button className="btn btn-ghost btn-sm" onClick={() => act(`mods/${modId}/published`, { published: false })}>
              {t('unpublish')}
            </button>
          ) : null}
          <button className="btn btn-ghost btn-sm btn-danger" onClick={() => confirm(t('banConfirm')) && act(`users/${userId}/banned`, { banned: true })}>
            {t('ban')}
          </button>
        </div>
      </details>
    </div>
  );
}
