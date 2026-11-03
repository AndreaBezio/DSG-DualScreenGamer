import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getMe } from '@/lib/session';

export async function AccountButton() {
  const t = await getTranslations('nav');
  const me = await getMe();
  if (!me) {
    return (
      <Link href="/login" className="account-btn" data-nav>
        {t('signIn')}
      </Link>
    );
  }
  return (
    <Link href="/account" className="account-btn account-btn-user" data-nav title={me.display_name}>
      {me.avatar_url ? <img src={me.avatar_url} alt="" /> : <span className="avatar-fallback">{me.display_name.slice(0, 1)}</span>}
      <span className="account-name">{me.display_name}</span>
    </Link>
  );
}
