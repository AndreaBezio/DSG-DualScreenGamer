import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Console } from '@/components/Console';
import { CopyButton } from '@/components/CopyButton';
import { Icon } from '@/components/Icon';
import { TileArt } from '@/components/Tile';
import { api, formatBytes, PUBLIC_API_URL } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const mod = await api.mod((await params).id);
  return mod ? { title: mod.name, description: mod.summary } : {};
}

export default async function ModPage({ params }: Props) {
  const { id } = await params;
  const mod = await api.mod(id);
  if (!mod) notFound();
  const [game, index, releases] = await Promise.all([mod.game_id ? api.game(mod.game_id) : null, api.index(), api.releases(id)]);
  const t = await getTranslations('mod');
  const tt = await getTranslations('types');
  const format = await getFormatter();
  const name = <K extends 'platforms' | 'emulators' | 'devices'>(list: K, key: string) =>
    (index[list] as { id: string; name: string }[]).find((x) => x.id === key)?.name ?? key;

  const rel = mod.latest_release;
  const assetName = (role?: string) => rel?.assets.find((a) => a.role === role)?.name ?? role ?? '';
  const cover = mod.screenshots[0] ?? game?.cover_url ?? null;

  const top = (
    <article className="hero">
      {cover ? <div className="hero-backdrop" style={{ backgroundImage: `url(${cover})` }} aria-hidden /> : null}
      <div className="hero-art">
        <TileArt id={mod.id} type={mod.type} cover={cover} title={mod.name} />
      </div>
      <div className="hero-body">
        <span className={`badge badge-${mod.type}`}>{tt(mod.type)}</span>
        <h1 className="hero-title">{mod.name}</h1>
        <p className="hero-sub">
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
        <p className="hero-summary">{mod.summary}</p>
        {rel ? (
          <div className="release-card">
            <div className="release-head">
              <strong>
                {t('latest')} · v{rel.version}
              </strong>
              {rel.prerelease ? <span className="chip chip-warn">{t('prerelease')}</span> : null}
              <span className="muted">{format.dateTime(new Date(rel.published_at), { dateStyle: 'medium' })}</span>
            </div>
            <div className="release-assets">
              {rel.assets.map((a) => (
                <a key={a.name} href={a.url} className="btn btn-primary btn-sm" data-nav rel="noopener">
                  <Icon name="download" size={16} />
                  {a.name}
                  <span className="btn-meta">{formatBytes(a.size)}</span>
                </a>
              ))}
            </div>
          </div>
        ) : (
          <p className="fineprint">{t('noRelease')}</p>
        )}
      </div>
    </article>
  );

  const apiCall = `curl -A "MyEmu/1.0" ${PUBLIC_API_URL}/v1/mods/${mod.id}/releases/latest`;

  const bottom = (
    <div className="panel">
      {mod.description ? (
        <div className="prose">
          {mod.description.split(/\n\s*\n/).map((para, i) => (
            <p key={i}>{para.replace(/\s*\n\s*/g, ' ')}</p>
          ))}
        </div>
      ) : null}

      {mod.install.length ? (
        <section className="section">
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

      {mod.requires.length ? (
        <section className="section">
          <h2>{t('requires')}</h2>
          <ul className="bullets">
            {mod.requires.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="section">
        <h2>{t('targets')}</h2>
        <div className="chips">
          {mod.targets.map((tg, i) => (
            <span className="chip" key={i}>
              {name('platforms', tg.platform)} · {tg.emulator ? name('emulators', tg.emulator) : t('anyEmulator')}
              {tg.min_version ? ` ≥ ${tg.min_version}` : ''}
              {tg.max_version ? ` ≤ ${tg.max_version}` : ''}
            </span>
          ))}
          {mod.devices.map((d) => (
            <span className="chip chip-strong" key={d}>
              {name('devices', d)}
            </span>
          ))}
        </div>
      </section>

      {rel?.assets.some((a) => a.sha256) ? (
        <section className="section">
          <h2>{t('sha256')}</h2>
          <ul className="kv">
            {rel.assets.map((a) => (
              <li key={a.name}>
                <span>{a.name}</span>
                {a.sha256 ? (
                  <>
                    <code className="hash">{a.sha256}</code>
                    <CopyButton text={a.sha256} label={t('sha256')} />
                  </>
                ) : (
                  <span className="muted">{t('noHash')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="section">
        <h2>{t('forDevs')}</h2>
        <div className="code">
          <code>{apiCall}</code>
          <CopyButton text={apiCall} label={t('forDevs')} />
        </div>
      </section>

      <section className="section meta-row">
        <a href={`https://github.com/${mod.source_repo}`} className="btn btn-ghost btn-sm" data-nav rel="noopener">
          <Icon name="external" size={16} />
          {t('source')}: {mod.source_repo}
        </a>
        {releases.length > 1 && rel ? (
          <a href={`https://github.com/${mod.source_repo}/releases`} className="btn btn-ghost btn-sm" data-nav rel="noopener">
            {t('allReleases')} ({releases.length})
          </a>
        ) : null}
        <span className="muted">
          {t('license')}: {mod.license}
          {mod.stars != null ? ` · ${t('stars', { count: mod.stars })}` : ''}
        </span>
      </section>
    </div>
  );

  return <Console top={top} bottom={bottom} back={game ? `/games/${game.id}` : '/'} />;
}
