'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export type HookRow = {
  id: string;
  kind: 'discord' | 'json';
  url: string;
  events: string[];
  filters: { game?: string; type?: string; device?: string };
  active: boolean;
  last_status: string | null;
  last_delivery_at: string | null;
  pending: number;
};

const EVENTS = ['mod_published', 'release_published'] as const;

export function WebhookManager({ items, types, devices }: { items: HookRow[]; types: { id: string; name: string }[]; devices: { id: string; name: string }[] }) {
  const t = useTranslations('webhooks');
  const router = useRouter();
  const [form, setForm] = useState({ kind: 'discord', url: '', events: [...EVENTS] as string[], type: '', device: '' });
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  async function call(path: string, method: string, body?: object) {
    const res = await fetch(`/bff/admin/${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  }

  async function add() {
    setError(null);
    try {
      const filters = { ...(form.type ? { type: form.type } : {}), ...(form.device ? { device: form.device } : {}) };
      const r = await call('webhooks', 'POST', { kind: form.kind, url: form.url, events: form.events, filters });
      setSecret(r.secret ?? null);
      setForm({ ...form, url: '' });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <section className="sheet">
        <h2>{t('add')}</h2>
        <div className="segmented-tabs">
          {(['discord', 'json'] as const).map((k) => (
            <button key={k} type="button" className={form.kind === k ? 'on' : ''} onClick={() => setForm({ ...form, kind: k })}>
              {t(`kind.${k}`)}
            </button>
          ))}
        </div>
        <p className="fineprint">{t(`hint.${form.kind}`)}</p>
        <div className="compat-form">
          <input value={form.url} placeholder={form.kind === 'discord' ? 'https://discord.com/api/webhooks/…' : 'https://'} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <div className="chips">
            {EVENTS.map((ev) => (
              <label className="check chip" key={ev}>
                <input
                  type="checkbox"
                  checked={form.events.includes(ev)}
                  onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, ev] : form.events.filter((x) => x !== ev) })}
                />
                {t(`event.${ev}`)}
              </label>
            ))}
          </div>
          <div className="inline-row">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} aria-label={t('onlyType')}>
              <option value="">{t('anyType')}</option>
              {types.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <select value={form.device} onChange={(e) => setForm({ ...form, device: e.target.value })} aria-label={t('onlyDevice')}>
              <option value="">{t('anyDevice')}</option>
              {devices.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={add} data-nav>
              {t('save')}
            </button>
          </div>
          {error ? <p className="field-error">{error}</p> : null}
          {secret ? (
            <p className="notice notice-warn">
              {t('secret')} <code>{secret}</code>
            </p>
          ) : null}
        </div>
      </section>

      <section className="sheet">
        <h2>{t('list')}</h2>
        {items.length ? (
          <ul className="list">
            {items.map((w) => (
              <li key={w.id} className="row">
                <span className="row-main">
                  <strong>
                    {t(`kind.${w.kind}`)} · <code>{w.url}</code>
                  </strong>
                  <span>
                    {w.events.map((e) => t(`event.${e}`)).join(', ')}
                    {w.filters.type ? ` · ${w.filters.type}` : ''}
                    {w.filters.device ? ` · ${w.filters.device}` : ''}
                  </span>
                  <span>
                    {w.last_status ? `${t('last')}: ${w.last_status}` : t('never')}
                    {w.pending ? ` · ${t('pending', { count: w.pending })}` : ''}
                  </span>
                </span>
                <span className="row-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => call(`webhooks/${w.id}/test`, 'POST').then(() => router.refresh())}>
                    {t('test')}
                  </button>
                  <button className="btn btn-ghost btn-sm btn-danger" onClick={() => confirm(t('confirmDelete')) && call(`webhooks/${w.id}`, 'DELETE').then(() => router.refresh())}>
                    {t('delete')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t('none')}</p>
        )}
      </section>
    </>
  );
}
