import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Empty, GameCard, Panel } from '@/components/Cards';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Games' };

type Props = { searchParams: Promise<{ q?: string; platform?: string }> };

export default async function GamesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const [t, games, index] = await Promise.all([getTranslations('games'), api.games({ q: sp.q, platform: sp.platform }), api.index()]);
  const withGames = index.platforms.filter((p) => index.games.some((g) => g.platforms.includes(p.id)));
  const href = (platform?: string) => {
    const q = new URLSearchParams();
    if (sp.q) q.set('q', sp.q);
    if (platform) q.set('platform', platform);
    return q.size ? `/games?${q}` : '/games';
  };

  return (
    <>
      <header className="page-head">
        <h1>{t('title')}</h1>
        <form className="inline-search" role="search">
          <Icon name="search" size={16} />
          <input type="search" name="q" defaultValue={sp.q} placeholder={t('search')} aria-label={t('search')} data-nav />
          {sp.platform ? <input type="hidden" name="platform" value={sp.platform} /> : null}
        </form>
      </header>
      <nav className="chip-tabs">
        <Link href={href()} className={`chip-tab${!sp.platform ? ' on' : ''}`} data-nav>
          {t('allPlatforms')}
        </Link>
        {withGames.map((p) => (
          <Link key={p.id} href={href(p.id)} className={`chip-tab${sp.platform === p.id ? ' on' : ''}`} data-nav>
            {p.name}
          </Link>
        ))}
      </nav>
      <Panel title={t('count', { count: games.length })}>
        {games.length ? (
          <div className="card-grid card-grid-games">
            {games.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
        ) : (
          <Empty>{t('none')}</Empty>
        )}
      </Panel>
    </>
  );
}
