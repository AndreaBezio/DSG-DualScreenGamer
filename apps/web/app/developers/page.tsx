import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Console } from '@/components/Console';
import { CopyButton } from '@/components/CopyButton';
import { Icon } from '@/components/Icon';
import { PUBLIC_API_URL } from '@/lib/api';

export const metadata: Metadata = { title: 'Developers' };

const ENDPOINTS = [
  ['GET', '/v1/lookup?platform=3ds&title_id=…&emulator=azahar&emulator_version=…&device=ayn-thor'],
  ['GET', '/v1/mods/{id}/releases/latest'],
  ['GET', '/v1/games?q=…&platform=…'],
  ['GET', '/v1/mods?game=…&type=…&device=…'],
  ['GET', '/v1/platforms · /v1/emulators · /v1/devices'],
  ['GET', '/v1/index.json'],
] as const;

export default async function Developers() {
  const t = await getTranslations('dev');
  const example = `curl -A "MyEmu/1.0" "${PUBLIC_API_URL}/v1/lookup?platform=pc&steam_appid=413150&device=ayn-thor"`;

  const top = (
    <article className="hero hero-text">
      <div className="hero-body">
        <span className="badge badge-utility">API v1</span>
        <h1 className="hero-title">{t('title')}</h1>
        <p className="hero-summary">{t('lead')}</p>
        <a href={`${PUBLIC_API_URL}/v1/docs`} className="btn btn-primary" data-nav>
          <Icon name="code" size={16} />
          {t('docs')}
        </a>
      </div>
    </article>
  );

  const bottom = (
    <div className="panel">
      <section className="section">
        <h2>{t('steps')}</h2>
        <ol className="steps">
          <li>{t('step1')}</li>
          <li>{t('step2')}</li>
          <li>{t('step3')}</li>
          <li>{t('step4', { var: '{emulator.textures_dir}' })}</li>
        </ol>
      </section>
      <div className="code">
        <code>{example}</code>
        <CopyButton text={example} label="Copy" />
      </div>
      <ul className="endpoints">
        {ENDPOINTS.map(([m, p]) => (
          <li key={p}>
            <span className="method">{m}</span>
            <code>{p}</code>
          </li>
        ))}
      </ul>
      <p className="fineprint">{t('userAgent')}</p>
      <p className="fineprint">{t('offline')}</p>
    </div>
  );

  return <Console top={top} bottom={bottom} back="/" />;
}
