import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CopyButton } from '@/components/CopyButton';
import { Icon } from '@/components/Icon';
import { PUBLIC_API_URL } from '@/lib/api';

export const metadata: Metadata = { title: 'Developers' };

const ENDPOINTS = [
  ['/v1/lookup', 'lookup'],
  ['/v1/mods/{id}/releases/latest', 'latest'],
  ['/v1/mods', 'mods'],
  ['/v1/games', 'games'],
  ['/v1/platforms · /v1/emulators · /v1/devices', 'catalog'],
  ['/v1/index.json', 'index'],
] as const;

export default async function Developers() {
  const t = await getTranslations('dev');
  const example = `curl -A "MyEmu/1.0" "${PUBLIC_API_URL}/v1/lookup?platform=pc&steam_appid=413150&device=ayn-thor"`;

  return (
    <article className="doc">
      <header className="page-head page-head-doc">
        <span className="badge type-utility">API v1</span>
        <h1>{t('title')}</h1>
        <p className="lead">{t('lead')}</p>
        <a href={`${PUBLIC_API_URL}/v1/docs`} className="btn btn-primary" data-nav>
          <Icon name="code" size={16} />
          {t('docs')}
        </a>
      </header>
      <section className="sheet">
        <h2>{t('steps')}</h2>
        <ol className="steps">
          <li>{t('step1')}</li>
          <li>{t('step2')}</li>
          <li>{t('step3')}</li>
          <li>{t('step4', { var: '{emulator.textures_dir}' })}</li>
        </ol>
        <div className="code">
          <code>{example}</code>
          <CopyButton text={example} label="Copy" />
        </div>
      </section>
      <section className="sheet">
        <h2>{t('endpoints')}</h2>
        <ul className="endpoints">
          {ENDPOINTS.map(([path, key]) => (
            <li key={path}>
              <span className="method">GET</span>
              <code>{path}</code>
              <span className="muted">{t(`ep.${key}`)}</span>
            </li>
          ))}
        </ul>
        <p className="fineprint">{t('userAgent')}</p>
        <p className="fineprint">{t('offline')}</p>
      </section>
    </article>
  );
}
