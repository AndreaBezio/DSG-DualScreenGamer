import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Console } from '@/components/Console';
import { Icon } from '@/components/Icon';
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
  const tt = await getTranslations('types');
  const platformName = new Map(index.platforms.map((p) => [p.id, p.name]));

  const top = (
    <article className="hero">
      {game.cover_url ? <div className="hero-backdrop" style={{ backgroundImage: `url(${game.cover_url})` }} aria-hidden /> : null}
      <div className="hero-art">
        <TileArt id={game.id} type="game" cover={game.cover_url} title={game.title} />
      </div>
      <div className="hero-body">
        <span className="badge badge-game">{tt('game')}</span>
        <h1 className="hero-title">
          {game.title}
          {game.release_year ? <span className="hero-year"> {game.release_year}</span> : null}
        </h1>
        {game.summary ? <p className="hero-summary">{game.summary}</p> : null}
        <div className="chips">
          {game.platforms.map((p) => (
            <span className="chip" key={p}>
              {platformName.get(p) ?? p}
            </span>
          ))}
          <span className="chip chip-strong">{t('mods', { count: mods.length })}</span>
        </div>
        {game.igdb_id ? <p className="fineprint">{t('metadata')}</p> : null}
      </div>
    </article>
  );

  const bottom = (
    <div className="panel">
      {mods.length ? (
        <ul className="list">
          {mods.map((m) => (
            <li key={m.id}>
              <Link href={`/mods/${m.id}`} className="row" data-nav>
                <span className="row-icon">
                  <Icon name={m.type} />
                </span>
                <span className="row-main">
                  <strong>{m.name}</strong>
                  <span>{m.summary}</span>
                </span>
                <span className="row-side">
                  <span className={`badge badge-${m.type}`}>{tt(m.type)}</span>
                  {m.latest_release ? <span className="muted">v{m.latest_release.version}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">
          {t('noMods')} <Link href="/submit">→</Link>
        </p>
      )}
      {game.identifiers.length ? (
        <section className="section">
          <h2>{t('identifiers')}</h2>
          <ul className="kv">
            {game.identifiers.map((i) => (
              <li key={`${i.kind}:${i.value}`}>
                <span>{i.kind}</span>
                <code>{i.value}</code>
                {i.region ? <span className="muted">{i.region}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );

  return <Console top={top} bottom={bottom} back="/" />;
}
