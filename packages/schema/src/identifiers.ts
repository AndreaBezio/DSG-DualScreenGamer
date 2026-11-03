import { z } from 'zod';

/**
 * Ways an emulator, launcher or store can recognise a game.
 * Emulators never know an IGDB id: they know a ROM hash, a title id, a disc serial…
 */
export const IDENTIFIER_KINDS = [
  'sha1',
  'md5',
  'crc32',
  'title_id',
  'serial',
  'steam_appid',
  'gog_id',
  'android_pkg',
  /** Game ids in other catalogs, as used by frontends after scraping */
  'retroachievements',
  'screenscraper',
  'launchbox',
] as const;
export const IdentifierKind = z.enum(IDENTIFIER_KINDS);
export type IdentifierKind = z.infer<typeof IdentifierKind>;

const PATTERNS: Record<IdentifierKind, RegExp> = {
  sha1: /^[0-9a-f]{40}$/,
  md5: /^[0-9a-f]{32}$/,
  crc32: /^[0-9a-f]{8}$/,
  // Switch / 3DS / Wii U title ids are 16 hex digits
  title_id: /^[0-9A-F]{16}$/,
  // Disc serials: SLUS-20062, BLES-01807, CUSA00419, RVL-SMNE-USA…
  serial: /^[A-Z0-9]{2,6}(-[A-Z0-9]{2,8}){0,3}$/,
  steam_appid: /^[1-9][0-9]*$/,
  gog_id: /^[1-9][0-9]*$/,
  android_pkg: /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/,
  retroachievements: /^[1-9][0-9]*$/,
  screenscraper: /^[1-9][0-9]*$/,
  launchbox: /^[1-9][0-9]*$/,
};

/** Canonical form used for storage and lookup, so clients don't have to care about casing. */
export function normalizeIdentifier(kind: IdentifierKind, value: string): string {
  const v = value.trim();
  switch (kind) {
    case 'sha1':
    case 'md5':
    case 'crc32':
      return v.toLowerCase().replace(/^0x/, '');
    case 'title_id':
      return v.toUpperCase().replace(/^0X/, '');
    case 'serial':
      return v.toUpperCase().replace(/[\s_]/g, '-');
    case 'android_pkg':
      return v.toLowerCase();
    default:
      return v;
  }
}

export function isValidIdentifier(kind: IdentifierKind, value: string): boolean {
  return PATTERNS[kind].test(normalizeIdentifier(kind, value));
}

export const Identifier = z
  .object({
    kind: IdentifierKind,
    value: z.string().min(1),
    platform: z.string().optional().describe('Platform id from catalog/platforms.yaml'),
    region: z.string().optional().describe('e.g. USA, EUR, JPN'),
    label: z.string().optional().describe('Free text, e.g. "Rev 1"'),
  })
  .strict()
  .refine((i) => isValidIdentifier(i.kind, i.value), {
    message: 'value is not valid for this identifier kind',
    path: ['value'],
  });
export type Identifier = z.infer<typeof Identifier>;
