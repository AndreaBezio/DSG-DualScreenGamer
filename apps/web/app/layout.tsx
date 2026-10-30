import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PadNav } from '@/components/PadNav';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {
    title: { default: t('title'), template: `%s · DSG` },
    description: t('description'),
    metadataBase: process.env.PUBLIC_SITE_URL ? new URL(process.env.PUBLIC_SITE_URL) : undefined,
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e6e3dc' },
    { media: '(prefers-color-scheme: dark)', color: '#17191c' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={await getLocale()}>
      <body>
        <NextIntlClientProvider>
          <PadNav />
          <main>{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
