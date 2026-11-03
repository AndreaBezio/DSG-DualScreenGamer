import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AccountButton } from './AccountButton';
import { Clock } from './Clock';
import { Icon } from './Icon';

/** Status-bar style header: logo, sections, search, clock. */
export function SiteHeader() {
  const t = useTranslations('nav');
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand" data-nav>
          <span className="brand-mark" aria-hidden>
            <span />
            <span />
          </span>
          <span className="brand-name">DSG</span>
          <span className="brand-full">Dual Screen Gamer</span>
        </Link>
        <nav className="site-nav">
          <Link href="/mods" data-nav>
            {t('mods')}
          </Link>
          <Link href="/games" data-nav>
            {t('games')}
          </Link>
          <Link href="/devices" data-nav>
            {t('devices')}
          </Link>
          <Link href="/developers" data-nav>
            {t('developers')}
          </Link>
          <Link href="/submit" data-nav className="nav-cta">
            <Icon name="plus" size={16} />
            {t('submit')}
          </Link>
        </nav>
        <form action="/mods" className="header-search" role="search">
          <Icon name="search" size={16} />
          <input type="search" name="q" placeholder={t('search')} aria-label={t('search')} data-nav />
        </form>
        <Clock />
        <AccountButton />
      </div>
    </header>
  );
}

export function SiteFooter() {
  const t = useTranslations('footer');
  return (
    <footer className="site-footer">
      <p>{t('line')}</p>
      <p>{t('credits')}</p>
      <p>
        <Link href="/developers">API</Link> · <a href="https://github.com/AndreaBezio/DSG-DualScreenGamer">GitHub</a>
      </p>
    </footer>
  );
}
