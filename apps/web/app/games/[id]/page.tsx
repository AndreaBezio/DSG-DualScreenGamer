import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Empty, ModCard, Panel } from '@/components/Cards';
import { TileArt } from '@/components/Tile';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const game = await api.game((await params).id);
  return game ? { title: game.title, description: game.summary ?? undefined } : {};
}

export default async function GamePage({ params }: Props) {
  const { id } = await params;
  const [game, mods, index] = await Promise.all([api.game(id), api.modsForGame(id), api.index()]);
  if (!game) notFound();
  const t = await getTranslations('game');
  const platformNames = new Map(index.platforms.map((p) => [p.id, p.name]));

  return (
    <>
      <nav className="crumbs">
        <Link href="/games">{t('crumb')}</Link>
      </nav>
      <header className="item-head item-head-game">
        <span className="item-icon item-cover">
          <TileArt id={game.id} type="game" cover={game.cover_url} title={game.title} />
        </span>
        <div className="item-title">
          <h1>
            {game.title}
            {game.release_year ? <span className="muted"> ({game.release_year})</span> : null}
          </h1>
          <ul className="chips">
            {game.platforms.map((p) => (
              <li className="chip" key={p}>
                {platformNames.get(p) ?? p}
              </li>
            ))}
          </ul>
          {game.summary ? <p className="item-summary">{game.summary}</p> : null}
          {game.identifiers.length ? (
            <details className="ids">
              <summary data-nav>{t('identifiers', { count: game.identifiers.length })}</summary>
              <ul className="kv">
                {game.identifiers.map((i) => (
                  <li key={`${i.kind}:${i.value}`}>
                    <span>{i.kind}</span>
                    <code>{i.value}</code>
                    {i.region ? <span className="muted">{i.region}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {game.igdb_id ? <p className="fineprint">{t('metadata')}</p> : null}
        </div>
      </header>

      <Panel title={t('mods', { count: mods.length })}>
        {mods.length ? (
          <div className="card-grid">
            {mods.map((m) => (
              <ModCard key={m.id} mod={m} platformNames={platformNames} />
            ))}
          </div>
        ) : (
          <Empty>
            {t('noMods')} <Link href="/submit">{t('addOne')}</Link>
          </Empty>
        )}
      </Panel>
    </>
  );
}
