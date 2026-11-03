import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ModCard, Panel } from '@/components/Cards';
import { frameStyle } from '@/lib/frame';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await api.device((await params).id);
  return d ? { title: d.name } : {};
}

export default async function DevicePage({ params }: Props) {
  const { id } = await params;
  const [device, index] = await Promise.all([api.device(id), api.index()]);
  if (!device) notFound();
  const t = await getTranslations('devices');
  const made = index.mods.filter((m) => m.devices.includes(device.id));
  const platformNames = new Map(index.platforms.map((p) => [p.id, p.name]));
  const gameTitle = new Map(index.games.map((g) => [g.id, g.title]));
  const emuName = (e: string) => index.emulators.find((x) => x.id === e)?.name ?? e;
  const total = device.reports.works + device.reports.issues + device.reports.broken;

  return (
    <>
      <nav className="crumbs">
        <Link href="/devices">{t('title')}</Link>
      </nav>
      <header className="item-head item-head-game">
        {device.displays.length >= 2 ? (
          <span className="dsp device-frame" style={frameStyle(device.displays)} aria-hidden>
            <span className="dsp-device">
              <span className="dsp-screen dsp-top" style={{ display: 'block', background: 'linear-gradient(135deg,#0e9f96,#1b2f4a)' }} />
              <span className="dsp-hinge" />
              <span className="dsp-screen dsp-bottom" style={{ display: 'block', background: 'linear-gradient(135deg,#35d49b,#0e9f96)' }} />
            </span>
          </span>
        ) : null}
        <div className="item-title">
          <h1>{device.name}</h1>
          <p className="muted">
            {device.manufacturer}
            {device.chipset ? ` · ${device.chipset}` : ''} · {device.os}
          </p>
          <p>{t('modCount', { count: device.mod_count })}</p>
          {total ? (
            <p className="muted">
              {t('reports')}: {device.reports.works} ✓ · {device.reports.issues} ! · {device.reports.broken} ✕
            </p>
          ) : null}
        </div>
      </header>

      <div className="item-layout">
        <div className="item-main">
          <section className="sheet">
            <h2>{t('settings')}</h2>
            {device.profiles.length ? (
              device.profiles.map((p) => (
                <div className="profile" key={p.emulator}>
                  <h3>{emuName(p.emulator)}</h3>
                  {p.note ? <p className="fineprint">{p.note}</p> : null}
                  <ul className="kv">
                    {p.settings.map((s) => (
                      <li key={s.name}>
                        <span>{s.name}</span>
                        <strong>{s.value}</strong>
                        {s.note ? <span className="muted">{s.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                  <a href={p.source_url} className="side-link" rel="noopener" data-nav>
                    <Icon name="external" size={14} /> {t('source')}: {new URL(p.source_url).hostname}
                  </a>
                </div>
              ))
            ) : (
              <p className="muted">{t('noProfiles')}</p>
            )}
          </section>
        </div>
        <aside className="item-side">
          <section className="sheet">
            <h2>{t('screens')}</h2>
            <table className="spec-table">
              <thead>
                <tr>
                  <th>{t('screen')}</th>
                  <th>{t('size')}</th>
                  <th>{t('resolution')}</th>
                  <th>{t('panel')}</th>
                </tr>
              </thead>
              <tbody>
                {device.displays.map((d) => (
                  <tr key={d.role}>
                    <td>{t(d.role)}</td>
                    <td>{d.diagonal_in ? `${d.diagonal_in}″` : '—'}</td>
                    <td>
                      {d.width}×{d.height}
                      {d.refresh_hz ? ` @${d.refresh_hz}Hz` : ''}
                    </td>
                    <td>
                      {d.panel?.toUpperCase() ?? '—'}
                      {d.touch ? `, ${t('touch')}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {device.sources.length ? (
              <p className="fineprint">
                {t('specSources')}{' '}
                {device.sources.map((s, i) => (
                  <span key={s}>
                    {i ? ', ' : ''}
                    <a href={s} rel="noopener">
                      {new URL(s).hostname}
                    </a>
                  </span>
                ))}
              </p>
            ) : null}
          </section>
        </aside>
      </div>

      {made.length ? (
        <Panel title={t('mods')}>
          <div className="card-grid">
            {made.map((m) => (
              <ModCard key={m.id} mod={m} gameTitle={m.game_id ? gameTitle.get(m.game_id) : undefined} platformNames={platformNames} />
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
