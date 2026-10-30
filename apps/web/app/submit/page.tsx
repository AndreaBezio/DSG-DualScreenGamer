import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
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
previews:   # optional: screenshots are also found in your README
  - { top: shots/map-top.png, bottom: shots/map-bottom.png }
targets:
  - { platform: 3ds, emulator: azahar }
install:
  - { action: extract, asset: main, to: "{emulator.load_dir}/{game.title_id}" }`;

export default async function Submit() {
  const t = await getTranslations('submit');

  return (
    <article className="doc">
      <header className="page-head page-head-doc">
        <span className="badge type-patch">Registry</span>
        <h1>{t('title')}</h1>
        <p className="lead">{t('lead')}</p>
        <a href={`${REPO}/blob/main/docs/manifest.md`} className="btn btn-primary" data-nav rel="noopener">
          <Icon name="external" size={16} />
          {t('guide')}
        </a>
      </header>
      <section className="sheet">
        <ol className="steps">
          <li>{t('step1')}</li>
          <li>{t('step2')}</li>
          <li>{t('step3')}</li>
          <li>{t('step4')}</li>
        </ol>
      </section>
      <section className="sheet">
        <h2>{t('images')}</h2>
        <p>{t('imagesBody')}</p>
      </section>
      <section className="sheet">
        <h2>{t('example')}</h2>
        <pre className="code code-block">
          <code>{EXAMPLE}</code>
        </pre>
      </section>
    </article>
  );
}
