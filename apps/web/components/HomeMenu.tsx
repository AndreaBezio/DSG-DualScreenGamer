'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { Console } from './Console';
import { Icon } from './Icon';
import { TileArt } from './Tile';

export type MenuItem = {
  key: string;
  kind: 'game' | 'mod';
  id: string;
  title: string;
  type: string;
  cover: string | null;
  href: string;
  summary: string;
  meta: string[];
  gameTitle?: string;
  version?: string;
};

type Filter = 'all' | 'game' | 'mod';

/**
 * Home: the bottom screen is an icon grid, the top screen previews the selected icon.
 * First tap selects, second tap opens — on narrow screens a single tap opens.
 */
export function HomeMenu({ items, stats }: { items: MenuItem[]; stats: { games: number; mods: number } }) {
  const t = useTranslations('home');
  const tt = useTranslations('types');
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const wasSelected = useRef(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (filter === 'all' || i.kind === filter) &&
        (!q || i.title.toLowerCase().includes(q) || i.gameTitle?.toLowerCase().includes(q) || i.meta.some((m) => m.toLowerCase().includes(q))),
    );
  }, [items, filter, query]);

  const current = items.find((i) => i.key === selected) ?? null;
  const narrow = () => window.matchMedia('(max-width: 720px)').matches;

  const top = current ? (
    <article className="preview" key={current.key}>
      <div className="preview-art">
        <TileArt id={current.id} type={current.kind === 'game' ? 'game' : current.type} cover={current.cover} title={current.title} />
      </div>
      <div className="preview-body">
        <span className={`badge badge-${current.kind === 'game' ? 'game' : current.type}`}>
          {tt(current.kind === 'game' ? 'game' : current.type)}
        </span>
        <h1 className="preview-title">{current.title}</h1>
        {current.gameTitle ? <p className="preview-sub">{current.gameTitle}</p> : null}
        <p className="preview-summary">{current.summary}</p>
        <div className="chips">
          {current.version ? <span className="chip chip-strong">v{current.version}</span> : null}
          {current.meta.map((m) => (
            <span className="chip" key={m}>
              {m}
            </span>
          ))}
        </div>
        <Link href={current.href} className="btn btn-primary" data-nav>
          {t('open')}
        </Link>
      </div>
    </article>
  ) : (
    <div className="welcome">
      <div className="welcome-mark" aria-hidden>
        <span />
        <span />
      </div>
      <h1>{t('welcomeTitle')}</h1>
      <p>{t('welcomeBody')}</p>
      <p className="welcome-stats">{t('stats', stats)}</p>
    </div>
  );

  const bottom = (
    <div className="menu">
      <div className="menu-tools">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder={t('search')}
            aria-label={t('search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-nav
          />
        </label>
        <div className="segmented" role="tablist">
          {(['all', 'game', 'mod'] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={filter === f ? 'on' : ''}
              onClick={() => setFilter(f)}
              data-nav
            >
              {t(f === 'all' ? 'filterAll' : f === 'game' ? 'filterGames' : 'filterMods')}
            </button>
          ))}
        </div>
      </div>
      {visible.length ? (
        <ul className="grid" aria-label={t('hint')}>
          {visible.map((i) => (
            <li key={i.key}>
              <a
                href={i.href}
                className={`tile${selected === i.key ? ' selected' : ''}`}
                aria-label={i.title}
                title={i.title}
                data-nav
                onPointerDown={() => {
                  wasSelected.current = selected === i.key;
                }}
                onFocus={() => setSelected(i.key)}
                onClick={(e) => {
                  e.preventDefault();
                  // Keyboard/gamepad activation focuses first, so a click without pointer means "open"
                  const open = narrow() || wasSelected.current || e.detail === 0;
                  wasSelected.current = false;
                  if (open) router.push(i.href);
                  else setSelected(i.key);
                }}
              >
                <TileArt id={i.id} type={i.kind === 'game' ? 'game' : i.type} cover={i.cover} title={i.title} />
                <span className="tile-label">{i.title}</span>
                {i.kind === 'mod' ? (
                  <span className="tile-kind" aria-hidden>
                    <Icon name={i.type} size={12} />
                  </span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{t('empty')}</p>
      )}
      <p className="hint">
        <span className="hint-pointer">{t('hint')}</span>
        <span className="hint-pad">{t('hintPad')}</span>
      </p>
    </div>
  );

  return <Console top={top} bottom={bottom} />;
}
