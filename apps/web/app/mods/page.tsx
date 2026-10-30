import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Empty, ModCard, Panel } from '@/components/Cards';
import { Icon } from '@/components/Icon';
import { TypeTabs } from '@/components/TypeTabs';
import { api, MOD_TYPES, type ModType } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Mods' };

type Props = { searchParams: Promise<{ q?: string; type?: string; device?: string; platform?: string }> };

export default async function ModsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const type = MOD_TYPES.includes(sp.type as ModType) ? sp.type : undefined;
  const [t, tt, mods, index] = await Promise.all([
    getTranslations('mods'),
    getTranslations('types'),
    api.mods({ q: sp.q, type, device: sp.device, platform: sp.platform }),
    api.index(),
  ]);
  const platformNames = new Map(index.platforms.map((p) => [p.id, p.name]));
  const gameTitle = new Map(index.games.map((g) => [g.id, g.title]));

  return (
    <>
      <header className="page-head">
        <h1>{type ? tt(type) : t('title')}</h1>
        <form className="inline-search" role="search">
          <Icon name="search" size={16} />
          <input type="search" name="q" defaultValue={sp.q} placeholder={t('search')} aria-label={t('search')} data-nav />
          {type ? <input type="hidden" name="type" value={type} /> : null}
        </form>
      </header>
      <TypeTabs active={type} params={{ q: sp.q }} />
      <Panel title={t('count', { count: mods.length })}>
        {mods.length ? (
          <div className="card-grid">
            {mods.map((m) => (
              <ModCard key={m.id} mod={m} gameTitle={m.game_id ? gameTitle.get(m.game_id) : undefined} platformNames={platformNames} />
            ))}
          </div>
        ) : (
          <Empty>{t('none')}</Empty>
        )}
      </Panel>
    </>
  );
}
