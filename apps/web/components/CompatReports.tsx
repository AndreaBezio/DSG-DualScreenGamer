'use client';

import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { CompatReport, CompatSummary } from '@/lib/api';

type Option = { id: string; name: string };

export function CompatReports({
  modId,
  version,
  summary,
  items,
  devices,
  emulators,
  signedIn,
}: {
  modId: string;
  version: string | null;
  summary: CompatSummary;
  items: CompatReport[];
  devices: Option[];
  emulators: Option[];
  signedIn: boolean;
}) {
  const t = useTranslations('compat');
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ device: devices[0]?.id ?? '', firmware: '', emulator: '', emulator_version: '', result: 'works', note: '' });
  const [error, setError] = useState<string | null>(null);
  const name = (list: Option[], id: string | null) => list.find((x) => x.id === id)?.name ?? id;
  const total = summary.works + summary.issues + summary.broken;

  async function send() {
    setError(null);
    const body = Object.fromEntries(Object.entries({ ...form, mod_id: modId }).filter(([, v]) => v !== ''));
    const res = await fetch('/bff/me/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) return setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'error');
    setOpen(false);
    router.refresh();
  }

  return (
    <section className="sheet compat">
      <h2>{t('title')}</h2>
      {total ? (
        <ul className="compat-devices">
          {Object.entries(summary.by_device).map(([device, c]) => (
            <li key={device}>
              <strong>{name(devices, device)}</strong>
              <span className="compat-bar" aria-hidden>
                <span className="cb-works" style={{ flexGrow: c.works }} />
                <span className="cb-issues" style={{ flexGrow: c.issues }} />
                <span className="cb-broken" style={{ flexGrow: c.broken }} />
              </span>
              <span className="muted">{t('counts', c)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('none')}</p>
      )}

      {items.length ? (
        <ul className="compat-list">
          {items.map((r) => (
            <li key={r.id}>
              <span className={`result result-${r.result}`}>{t(`result.${r.result}`)}</span>
              <span className="compat-meta">
                <strong>{name(devices, r.device)}</strong>
                {r.firmware ? ` · ${t('firmware')} ${r.firmware}` : ''}
                {r.emulator ? ` · ${name(emulators, r.emulator)}${r.emulator_version ? ` ${r.emulator_version}` : ''}` : ''}
                {` · v${r.version}`}
                <span className="muted">
                  {' '}
                  — {r.user.display_name}, {format.dateTime(new Date(r.updated_at), { dateStyle: 'medium' })}
                </span>
              </span>
              {r.note ? <p className="compat-note">{r.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {signedIn ? (
        open ? (
          <div className="compat-form">
            <div className="inline-row">
              <select value={form.device} onChange={(e) => setForm({ ...form, device: e.target.value })} aria-label={t('device')}>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <input value={form.firmware} maxLength={40} placeholder={t('firmware')} onChange={(e) => setForm({ ...form, firmware: e.target.value })} />
            </div>
            <div className="inline-row">
              <select value={form.emulator} onChange={(e) => setForm({ ...form, emulator: e.target.value })} aria-label={t('emulator')}>
                <option value="">{t('emulator')}</option>
                {emulators.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <input value={form.emulator_version} maxLength={40} placeholder={t('emulatorVersion')} onChange={(e) => setForm({ ...form, emulator_version: e.target.value })} />
            </div>
            <div className="segmented-tabs">
              {(['works', 'issues', 'broken'] as const).map((r) => (
                <button key={r} type="button" className={form.result === r ? 'on' : ''} onClick={() => setForm({ ...form, result: r })}>
                  {t(`result.${r}`)}
                </button>
              ))}
            </div>
            <textarea rows={2} maxLength={500} value={form.note} placeholder={t('note')} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <div className="row-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={send} data-nav>
                {t('send', { version: version ?? '?' })}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                {t('cancel')}
              </button>
            </div>
            {error ? <p className="field-error">{error}</p> : null}
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} data-nav>
            {t('add')}
          </button>
        )
      ) : (
        <a href={`/login?next=/mods/${modId}`} className="side-link">
          {t('signIn')}
        </a>
      )}
    </section>
  );
}
