import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { CopyButton } from '@/components/CopyButton';
import { DualScreenPreview } from '@/components/DualScreenPreview';
import { Icon } from '@/components/Icon';
import { TileArt } from '@/components/Tile';
import { api, formatBytes, PUBLIC_API_URL } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const mod = await api.mod((await params).id);
  return mod ? { title: mod.name, description: mod.summary, openGraph: mod.cover_url ? { images: [mod.cover_url] } : undefined } : {};
}

export default async function ModPage({ params }: Props) {
  const { id } = await params;
  const mod = await api.mod(id);
  if (!mod) notFound();
  const [game, index, releases] = await Promise.all([mod.game_id ? api.game(mod.game_id) : null, api.index(), api.releases(id)]);
  const t = await getTranslations('mod');
  const tt = await getTranslations('types');
  const format = await getFormatter();
  const name = (list: 'platforms' | 'emulators' | 'devices', key: string) =>
    (index[list] as { id: string; name: string }[]).find((x) => x.id === key)?.name ?? key;

  const rel = mod.latest_release;
  const assetName = (role?: string) => rel?.assets.find((a) => a.role === role)?.name ?? role ?? '';
  const hasPreview = mod.previews.length > 0 || mod.media.length > 0;
  // The first gallery image already fills the preview when there are no pairs
  const gallery = mod.previews.length ? mod.media : mod.media.slice(1);
  const apiCall = `curl -A "MyEmu/1.0" ${PUBLIC_API_URL}/v1/mods/${mod.id}/releases/latest`;

  return (
    <>
      <nav className="crumbs">
        <Link href="/mods">{t('crumb')}</Link>
        {game ? (
          <>
            <span>/</span>
            <Link href={`/games/${game.id}`}>{game.title}</Link>
          </>
        ) : null}
      </nav>

      <header className="item-head">
        <span className="item-icon">
          <TileArt id={mod.id} type={mod.type} cover={mod.cover_url} title={mod.name} />
        </span>
        <div className="item-title">
          <span className={`badge type-${mod.type}`}>
            <Icon name={mod.type} size={14} />
            {tt(mod.type)}
          </span>
          <h1>{mod.name}</h1>
          <p className="muted">
            {game ? (
              <>
                <Link href={`/games/${game.id}`} data-nav>
                  {game.title}
                </Link>{' '}
                ·{' '}
              </>
            ) : null}
            {t('by', { authors: mod.authors.map((a) => a.name).join(', ') })}
          </p>
          <p className="item-summary">{mod.summary}</p>
        </div>
        <div className="item-actions">
          {rel ? (
            rel.assets.map((a) => (
              <a key={a.name} href={a.url} className="btn btn-primary" data-nav rel="noopener">
                <Icon name="download" size={16} />
                <span className="btn-label">{a.name}</span>
                <span className="btn-meta">{formatBytes(a.size)}</span>
              </a>
            ))
          ) : (
            <p className="fineprint">{t('noRelease')}</p>
          )}
          <a href={`https://github.com/${mod.source_repo}`} className="btn btn-ghost" data-nav rel="noopener">
            <Icon name="external" size={16} />
            GitHub
          </a>
        </div>
      </header>

      <div className="item-layout">
        <div className="item-main">
          {hasPreview ? (
            <section className="sheet">
              <h2>{t('preview')}</h2>
              <DualScreenPreview previews={mod.previews} fallback={mod.media[0]} />
            </section>
          ) : null}

          {gallery.length ? (
            <section className="sheet">
              <h2>{t('gallery')}</h2>
              <div className="gallery">
                {gallery.map((m) => (
                  <a key={m.url} href={m.url} target="_blank" rel="noopener" className="gallery-item" data-nav>
                    <img src={m.url} alt={m.caption ?? ''} loading="lazy" />
                  </a>
                ))}
              </div>
              <p className="fineprint">{t('mediaSource')}</p>
            </section>
          ) : null}

          {mod.description ? (
            <section className="sheet prose">
              {mod.description.split(/\n\s*\n/).map((para, i) => (
                <p key={i}>{para.replace(/\s*\n\s*/g, ' ')}</p>
              ))}
            </section>
          ) : null}

          {mod.install.length ? (
            <section className="sheet">
              <h2>{t('install')}</h2>
              <ol className="steps">
                {mod.install.map((s, i) => (
                  <li key={i}>
                    {s.action === 'note'
                      ? s.text
                      : t(`step.${s.action}`, { asset: assetName(s.asset), to: s.to ?? '', text: s.text ?? '' })}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>

        <aside className="item-side">
          {rel ? (
            <section className="sheet">
              <h2>{t('latest')}</h2>
              <p className="release-line">
                <strong>v{rel.version}</strong>
                {rel.prerelease ? <span className="chip chip-warn">{t('prerelease')}</span> : null}
                <span className="muted">{format.dateTime(new Date(rel.published_at), { dateStyle: 'medium' })}</span>
              </p>
              <ul className="kv">
                {rel.assets.map((a) => (
                  <li key={a.name}>
                    <span>{a.name}</span>
                    {a.sha256 ? (
                      <>
                        <code className="hash" title={a.sha256}>
                          {a.sha256.slice(0, 16)}…
                        </code>
                        <CopyButton text={a.sha256} label={t('sha256')} />
                      </>
                    ) : (
                      <span className="muted">{t('noHash')}</span>
                    )}
                  </li>
                ))}
              </ul>
              {releases.length > 1 ? (
                <a href={`https://github.com/${mod.source_repo}/releases`} className="side-link" data-nav rel="noopener">
                  {t('allReleases')} ({releases.length})
                </a>
              ) : null}
            </section>
          ) : null}

          <section className="sheet">
            <h2>{t('targets')}</h2>
            <ul className="chips">
              {mod.targets.map((tg, i) => (
                <li className="chip" key={i}>
                  {name('platforms', tg.platform)} · {tg.emulator ? name('emulators', tg.emulator) : t('anyEmulator')}
                  {tg.min_version ? ` ≥ ${tg.min_version}` : ''}
                  {tg.max_version ? ` ≤ ${tg.max_version}` : ''}
                </li>
              ))}
              {mod.devices.map((d) => (
                <li className="chip chip-strong" key={d}>
                  {name('devices', d)}
                </li>
              ))}
            </ul>
          </section>

          {mod.requires.length ? (
            <section className="sheet">
              <h2>{t('requires')}</h2>
              <ul className="bullets">
                {mod.requires.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="sheet">
            <h2>{t('forDevs')}</h2>
            <div className="code">
              <code>{apiCall}</code>
              <CopyButton text={apiCall} label={t('forDevs')} />
            </div>
          </section>

          <p className="fineprint">
            {t('license')}: {mod.license}
            {mod.stars != null ? ` · ${t('stars', { count: mod.stars })}` : ''}
          </p>
        </aside>
      </div>
    </>
  );
}
