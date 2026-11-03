import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Game, Mod } from '@/lib/api';
import { Icon } from './Icon';
import { TileArt } from './Tile';

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/** HOME-menu style card: thick white frame, rounded picture inside, cursor on focus. */
export function ModCard({ mod, gameTitle, platformNames }: { mod: Mod; gameTitle?: string; platformNames: Map<string, string> }) {
  const t = useTranslations('types');
  const platforms = [...new Set(mod.targets.map((x) => platformNames.get(x.platform) ?? x.platform))];
  return (
    <Link href={`/mods/${mod.id}`} className="card mod-card" data-nav>
      <span className="card-pic">
        <TileArt id={mod.id} type={mod.type} cover={mod.cover_url} title={mod.name} />
        <span className={`card-type type-${mod.type}`} title={t(mod.type)}>
          <Icon name={mod.type} size={16} />
        </span>
      </span>
      <span className="card-body">
        <strong className="card-title">{mod.name}</strong>
        {gameTitle ? <span className="card-sub">{gameTitle}</span> : null}
        <span className="card-meta">
          {platforms.slice(0, 2).join(' · ')}
          <span className="card-badges">
            {mod.installs.last_30_days ? (
              <span className="card-installs" title={t('installs')}>
                <Icon name="download" size={12} />
                {compact(mod.installs.last_30_days)}
              </span>
            ) : null}
            {mod.latest_release ? <span className="card-version">v{mod.latest_release.version}</span> : null}
          </span>
        </span>
      </span>
    </Link>
  );
}

export function GameCard({ game }: { game: Game }) {
  const t = useTranslations('game');
  return (
    <Link href={`/games/${game.id}`} className="card game-card" data-nav>
      {/* Box art comes in many shapes: shown whole, over a blurred copy of itself */}
      <span className="card-pic" style={game.cover_url ? ({ '--art': `url("${game.cover_url}")` } as React.CSSProperties) : undefined}>
        <TileArt id={game.id} type="game" cover={game.cover_url} title={game.title} />
      </span>
      <span className="card-body">
        <strong className="card-title">{game.title}</strong>
        <span className="card-sub">{t('mods', { count: game.mod_count })}</span>
      </span>
    </Link>
  );
}

export function Panel({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      {title ? (
        <header className="panel-head">
          <h2>{title}</h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="empty">
      <Icon name="search" size={20} />
      {children}
    </p>
  );
}
