import { z } from 'zod';
import { EMULATOR_PATH_VARS, Slug } from './catalog.ts';
import { Identifier, IdentifierKind } from './identifiers.ts';

export const GAME_PATH_VARS = ['dir', 'mods_dir', 'title_id', 'serial'] as const;

const PATH_VAR_RE = /\{([a-z_]+)\.([a-z_]+)\}/g;

/** Install destinations are templates such as `{emulator.textures_dir}/{game.title_id}/`. */
export const PathTemplate = z
  .string()
  .min(1)
  .refine((p) => !p.split(/[\\/]/).includes('..'), 'must not contain ".."')
  .refine(
    (p) =>
      [...p.matchAll(PATH_VAR_RE)].every(([, scope, name]) =>
        scope === 'emulator'
          ? (EMULATOR_PATH_VARS as readonly string[]).includes(name!)
          : scope === 'game'
            ? (GAME_PATH_VARS as readonly string[]).includes(name!)
            : false,
      ),
    `unknown variable; allowed: ${EMULATOR_PATH_VARS.map((v) => `{emulator.${v}}`).join(', ')}, ${GAME_PATH_VARS.map((v) => `{game.${v}}`).join(', ')}`,
  )
  .refine((p) => p.startsWith('{'), 'must start with a path variable (no absolute paths)');

export const AssetRole = z.enum(['main', 'companion_apk', 'optional', 'source']);
export type AssetRole = z.infer<typeof AssetRole>;

export const InstallStep = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('extract'),
      asset: AssetRole,
      to: PathTemplate,
      /** Only extract this folder from inside the archive. */
      from: z.string().optional(),
    })
    .strict(),
  z.object({ action: z.literal('copy'), asset: AssetRole, to: PathTemplate }).strict(),
  z.object({ action: z.literal('install_apk'), asset: AssetRole }).strict(),
  z.object({ action: z.literal('note'), text: z.string().min(1) }).strict(),
]);
export type InstallStep = z.infer<typeof InstallStep>;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;

/** An image: absolute https URL, or a path inside the mod's GitHub repo (e.g. `docs/top.png`). */
export const MediaRef = z
  .string()
  .min(1)
  .refine(
    (v) => (/^https:\/\//.test(v) ? true : !v.startsWith('/') && !v.split('/').includes('..') && IMAGE_EXT.test(v)),
    'must be an https URL or a repo-relative image path (png, jpg, gif, webp)',
  );

export const Preview = z
  .object({
    top: MediaRef.describe('What the main (upper) screen shows'),
    bottom: MediaRef.describe('What the second (lower) screen shows'),
    caption: z.string().max(140).optional(),
  })
  .strict();
export type Preview = z.infer<typeof Preview>;

export const MOD_TYPES = [
  'dual_screen_layout',
  'texture_pack',
  'patch',
  'companion_app',
  'shader',
  'utility',
] as const;
export const ModType = z.enum(MOD_TYPES);
export type ModType = z.infer<typeof ModType>;

export const GameManifest = z
  .object({
    id: Slug,
    title: z.string().min(1),
    igdb: z.number().int().positive().optional().describe('IGDB game id; resolved automatically from identifiers when omitted'),
    platforms: z.array(Slug).min(1),
    identifiers: z.array(Identifier).default([]),
  })
  .strict();
export type GameManifest = z.infer<typeof GameManifest>;

export const Target = z
  .object({
    platform: Slug,
    emulator: Slug.optional().describe('Emulator / mod loader / frontend id from catalog/emulators.yaml'),
    min_version: z.string().optional(),
    max_version: z.string().optional(),
    /** Restrict to specific dumps/regions of the game. Empty = any. */
    identifiers: z.array(z.object({ kind: IdentifierKind, value: z.string() }).strict()).default([]),
  })
  .strict();
export type Target = z.infer<typeof Target>;

export const ModManifest = z
  .object({
    id: Slug,
    name: z.string().min(1).max(120),
    type: ModType,
    summary: z.string().min(1).max(200),
    description: z.string().optional(),
    game: Slug.optional().describe('Game id from registry/games; omit only for type "utility"'),
    authors: z.array(z.object({ name: z.string(), github: z.string().optional() }).strict()).min(1),
    license: z.string().describe('SPDX id, or "unknown"'),
    homepage: z.url().optional(),
    tags: z.array(z.string()).default([]),
    screenshots: z.array(MediaRef).default([]).describe('Gallery images; the first one is the card cover'),
    previews: z
      .array(Preview)
      .default([])
      .describe('Pairs of screenshots shown in the dual-screen preview, top and bottom screen'),
    requires: z.array(z.string()).default([]).describe('Human-readable requirements'),
    devices: z.array(Slug).default([]).describe('Devices the mod is designed for; empty = any dual-screen setup'),
    source: z
      .object({
        github: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'must be owner/repo'),
        assets: z
          .array(z.object({ role: AssetRole, pattern: z.string().min(1) }).strict())
          .min(1)
          .describe('Glob matched against release asset names'),
        prereleases: z.boolean().default(false),
        /** Collect images from the README, release notes and release assets. */
        auto_media: z.boolean().default(true),
        /** Glob on the release tag, for repos that publish several mods. */
        tag_pattern: z.string().optional(),
      })
      .strict(),
    targets: z.array(Target).min(1),
    install: z.array(InstallStep).default([]),
  })
  .strict()
  .refine((m) => m.type === 'utility' || m.game, { message: 'game is required unless type is "utility"', path: ['game'] })
  .refine(
    (m) => m.install.every((s) => s.action === 'note' || m.source.assets.some((a) => a.role === s.asset)),
    { message: 'install step references an asset role not declared in source.assets', path: ['install'] },
  );
export type ModManifest = z.infer<typeof ModManifest>;
