import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MOD_TYPES } from '@/lib/api';
import { Icon } from './Icon';

/** Toolbar of colored icon tabs, one per mod type. Links keep other query params. */
export function TypeTabs({ active, base = '/mods', params = {} }: { active?: string; base?: string; params?: Record<string, string | undefined> }) {
  const t = useTranslations('types');
  const href = (type?: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, type })) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  return (
    <nav className="type-tabs" aria-label={t('label')}>
      <Link href={href()} className={`type-tab${!active ? ' on' : ''}`} data-nav aria-current={!active ? 'page' : undefined}>
        <span className="type-icon type-all">
          <Icon name="grid" size={22} />
        </span>
        <span className="type-tab-label">{t('all')}</span>
      </Link>
      {MOD_TYPES.map((type) => (
        <Link
          key={type}
          href={href(type)}
          className={`type-tab${active === type ? ' on' : ''}`}
          data-nav
          aria-current={active === type ? 'page' : undefined}
        >
          <span className={`type-icon type-${type}`}>
            <Icon name={type} size={22} />
          </span>
          <span className="type-tab-label">{t(type)}</span>
        </Link>
      ))}
    </nav>
  );
}
