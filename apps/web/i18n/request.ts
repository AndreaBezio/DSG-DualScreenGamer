import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

// Add a locale here and a messages/<locale>.json file to translate the site.
export const locales = ['en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get('NEXT_LOCALE')?.value;
  const locale: Locale = locales.find((l) => l === fromCookie) ?? defaultLocale;
  return { locale, messages: (await import(`../messages/${locale}.json`)).default };
});
