import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Console } from '@/components/Console';
import { Icon } from '@/components/Icon';

export const metadata: Metadata = { title: 'Add a mod' };

const REPO = process.env.PUBLIC_REPO_URL ?? 'https://github.com/AndreaBezio/DSG-DualScreenGamer';

const EXAMPLE = `id: my-game-thor-layout
name: My Game — Thor layout
type: dual_screen_layout
summary: Map on the bottom screen, action on top.
game: my-game
authors: [{ name: you, github: you }]
license: MIT
devices: [ayn-thor]
source:
  github: you/my-game-thor-layout
  assets: [{ role: main, pattern: "*.zip" }]
targets:
  - { platform: 3ds, emulator: azahar }
install:
  - { action: extract, asset: main, to: "{emulator.load_dir}/{game.title_id}" }`;

export default async function Submit() {
  const t = await getTranslations('submit');

  const top = (
    <article className="hero hero-text">
      <div className="hero-body">
        <span className="badge badge-patch">Registry</span>
        <h1 className="hero-title">{t('title')}</h1>
        <p className="hero-summary">{t('lead')}</p>
        <a href={`${REPO}/blob/main/docs/manifest.md`} className="btn btn-primary" data-nav rel="noopener">
          <Icon name="external" size={16} />
          {t('guide')}
        </a>
      </div>
    </article>
  );

  const bottom = (
    <div className="panel">
      <ol className="steps">
        <li>{t('step1')}</li>
        <li>{t('step2')}</li>
        <li>{t('step3')}</li>
        <li>{t('step4')}</li>
      </ol>
      <section className="section">
        <h2>{t('example')}</h2>
        <pre className="code code-block">
          <code>{EXAMPLE}</code>
        </pre>
      </section>
    </div>
  );

  return <Console top={top} bottom={bottom} back="/" />;
}
