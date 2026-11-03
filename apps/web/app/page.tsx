import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { GameCard, ModCard, Panel } from '@/components/Cards';
import { DualScreenPreview } from '@/components/DualScreenPreview';
import { Icon } from '@/components/Icon';
import { TypeTabs } from '@/components/TypeTabs';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const t = await getTranslations('home');
  const index = await api.index();
  const platformNames = new Map(index.platforms.map((p) => [p.id, p.name]));
  const gameTitle = new Map(index.games.map((g) => [g.id, g.title]));
  // Spotlight: the most recently released mod that shows both screens
  const featured = index.mods.find((m) => m.previews.length) ?? index.mods.find((m) => m.media.length);

  return (
    <>
      <section className="hero">
        <div className="hero-text">
          <h1>{t('title')}</h1>
          <p className="lead">{t('lead')}</p>
          <form action="/mods" className="hero-search" role="search">
            <Icon name="search" size={18} />
            <input type="search" name="q" placeholder={t('search')} aria-label={t('search')} data-nav />
            <button className="btn btn-primary" data-nav>
              {t('searchButton')}
            </button>
          </form>
          <p className="hero-stats">{t('stats', { games: index.games.length, mods: index.mods.length })}</p>
        </div>
        {featured ? (
          <div className="hero-feature">
            {featured.previews.length ? (
              <DualScreenPreview
                previews={featured.previews}
                devices={index.devices.filter((d) => d.displays.length >= 2 && (!featured.devices.length || featured.devices.includes(d.id)))}
              />
            ) : (
              <img className="showcase" src={featured.media[0]!.url} alt={featured.name} />
            )}
            <Link href={`/mods/${featured.id}`} className="hero-feature-link" data-nav>
              {featured.name} <Icon name="next" size={14} />
            </Link>
          </div>
        ) : null}
      </section>

      <TypeTabs />

      <Panel
        title={t('latest')}
        action={
          <Link href="/mods" className="panel-link" data-nav>
            {t('allMods')}
          </Link>
        }
      >
        <div className="card-grid">
          {index.mods.slice(0, 12).map((m) => (
            <ModCard key={m.id} mod={m} gameTitle={m.game_id ? gameTitle.get(m.game_id) : undefined} platformNames={platformNames} />
          ))}
        </div>
      </Panel>

      <Panel
        title={t('games')}
        action={
          <Link href="/games" className="panel-link" data-nav>
            {t('allGames')}
          </Link>
        }
      >
        <div className="card-grid card-grid-games">
          {index.games.slice(0, 12).map((g) => (
            <GameCard key={g.id} game={g} />
          ))}
        </div>
      </Panel>
    </>
  );
}
