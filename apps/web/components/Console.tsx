import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Clock } from './Clock';
import { Icon } from './Icon';

/**
 * The two-screen frame every page renders into: a wide top screen for showing,
 * a smaller bottom screen for touching.
 */
export function Console({ top, bottom, back }: { top: ReactNode; bottom: ReactNode; back?: string }) {
  const t = useTranslations('nav');
  return (
    <div className="console">
      <section className="screen screen-top" aria-label="Top screen">
        <div className="screen-inner">
          <header className="statusbar">
            <Link href="/" className="brand" data-nav>
              <span className="brand-mark" aria-hidden>
                <span />
                <span />
              </span>
              DSG
            </Link>
            <span className="statusbar-title">Dual Screen Gamer</span>
            <Clock />
          </header>
          <div className="top-content">{top}</div>
        </div>
      </section>
      <div className="hinge" aria-hidden>
        <span />
        <span />
      </div>
      <section className="screen screen-bottom" aria-label="Bottom screen">
        <div className="screen-inner">
          <div className="bottom-content">{bottom}</div>
          <nav className="bottombar">
            {back ? (
              <Link href={back} className="pill" data-nav data-back aria-label={t('back')} title={t('back')}>
                <Icon name="back" size={18} />
              </Link>
            ) : null}
            <Link href="/" className="pill" data-nav>
              <Icon name="home" size={18} />
              <span>{t('home')}</span>
            </Link>
            <Link href="/developers" className="pill" data-nav>
              <Icon name="code" size={18} />
              <span>{t('developers')}</span>
            </Link>
            <Link href="/submit" className="pill" data-nav>
              <Icon name="plus" size={18} />
              <span>{t('submit')}</span>
            </Link>
          </nav>
        </div>
      </section>
    </div>
  );
}
