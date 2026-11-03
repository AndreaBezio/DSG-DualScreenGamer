import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PadNav } from '@/components/PadNav';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {
    title: { default: t('title'), template: `%s · DSG` },
    description: t('description'),
    metadataBase: process.env.PUBLIC_SITE_URL ? new URL(process.env.PUBLIC_SITE_URL) : undefined,
    alternates: {
      types: {
        'application/atom+xml': `${process.env.PUBLIC_API_URL ?? 'http://localhost:3001'}/v1/feed.atom`,
        'application/feed+json': `${process.env.PUBLIC_API_URL ?? 'http://localhost:3001'}/v1/feed.json`,
      },
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#16181c' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={await getLocale()}>
      <body>
        <NextIntlClientProvider>
          <PadNav />
          <SiteHeader />
          <main className="site-main">{children}</main>
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
