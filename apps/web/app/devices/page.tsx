import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Panel } from '@/components/Cards';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Devices' };

export default async function Devices() {
  const [t, index] = await Promise.all([getTranslations('devices'), api.index()]);
  const handhelds = index.devices.filter((d) => d.displays.length >= 2);
  return (
    <>
      <header className="page-head page-head-doc">
        <h1>{t('title')}</h1>
        <p className="lead">{t('lead')}</p>
      </header>
      <Panel>
        <div className="card-grid">
          {handhelds.map((d) => (
            <Link key={d.id} href={`/devices/${d.id}`} className="card" data-nav>
              <span className="card-body">
                <strong className="card-title">{d.name}</strong>
                <span className="card-sub">{d.manufacturer}</span>
                <span className="card-meta">
                  {d.displays.map((x) => `${x.diagonal_in ?? '?'}″ ${x.width}×${x.height}`).join(' + ')}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </Panel>
    </>
  );
}
