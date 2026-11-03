import { z } from '@hono/zod-openapi';
import { IDENTIFIER_KINDS, MOD_TYPES } from '@dsg/schema';

export const IdentifierDto = z
  .object({
    kind: z.enum(IDENTIFIER_KINDS),
    value: z.string(),
    platform: z.string().nullable(),
    region: z.string().nullable(),
    label: z.string().nullable(),
    source: z.enum(['manifest', 'dat']).openapi({ description: 'dat = added from the libretro-database DAT entry of the same dump' }),
  })
  .openapi('Identifier');

export const GameMediaDto = z
  .object({
    kind: z.enum(['cover', 'screenshot', 'title', 'artwork']),
    url: z.string(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    source: z.enum(['igdb', 'libretro']),
  })
  .openapi('GameMedia');

export const GameDto = z
  .object({
    id: z.string().openapi({ example: 'stardew-valley' }),
    title: z.string(),
    platforms: z.array(z.string()),
    igdb_id: z.number().nullable(),
    summary: z.string().nullable(),
    cover_url: z.string().nullable().openapi({ description: 'Box art / cover' }),
    hero_url: z.string().nullable().openapi({ description: 'Wide image for banners: key art or a screenshot' }),
    media: z.array(GameMediaDto),
    release_year: z.number().nullable(),
    identifiers: z.array(IdentifierDto),
    mod_count: z.number(),
  })
  .openapi('Game');

export const AssetDto = z
  .object({
    role: z.string().openapi({ description: 'main, companion_apk, optional or source; install steps refer to it' }),
    name: z.string(),
    url: z.string().openapi({ description: "Direct download from the author's GitHub release" }),
    size: z.number(),
    sha256: z.string().nullable().openapi({ description: 'Verify after download. Null when GitHub did not publish a digest.' }),
    content_type: z.string().nullable(),
  })
  .openapi('Asset');

export const ReleaseDto = z
  .object({
    tag: z.string(),
    version: z.string(),
    name: z.string().nullable(),
    prerelease: z.boolean(),
    published_at: z.string(),
    html_url: z.string(),
    changelog: z.string().nullable(),
    assets: z.array(AssetDto),
  })
  .openapi('Release');

export const TargetDto = z
  .object({
    platform: z.string(),
    emulator: z.string().nullable(),
    min_version: z.string().nullable(),
    max_version: z.string().nullable(),
    identifiers: z.array(z.object({ kind: z.string(), value: z.string() })),
  })
  .openapi('Target');

export const InstallStepDto = z
  .object({
    action: z.enum(['extract', 'copy', 'install_apk', 'note']),
    asset: z.string().optional(),
    to: z
      .string()
      .optional()
      .openapi({ description: 'Path template, e.g. {emulator.textures_dir}/{game.title_id}', example: '{game.mods_dir}' }),
    from: z.string().optional(),
    text: z.string().optional(),
  })
  .openapi('InstallStep');

export const MediaDto = z
  .object({
    url: z.string(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    source: z.enum(['manifest', 'upload', 'release', 'readme', 'asset']).openapi({ description: 'Where DSG found the image' }),
    caption: z.string().nullable(),
  })
  .openapi('Media');

export const PreviewDto = z
  .object({ top: MediaDto, bottom: MediaDto, caption: z.string().nullable() })
  .openapi('DualScreenPreview', { description: 'What the two screens show at the same moment' });

export const ModDto = z
  .object({
    id: z.string().openapi({ example: 'stardew-valley-dual-screen' }),
    name: z.string(),
    type: z.enum(MOD_TYPES),
    summary: z.string(),
    description: z.string().nullable(),
    game_id: z.string().nullable(),
    authors: z.array(z.object({ name: z.string(), github: z.string().optional() })),
    license: z.string(),
    homepage: z.string().nullable(),
    origin: z.enum(['registry', 'community']).openapi({ description: 'registry = YAML manifest on GitHub; community = submitted on the website' }),
    source_repo: z.string().nullable().openapi({ example: 'JoeCorrell/AYN-Thor-Dualscreen-Mods' }),
    source_url: z.string().nullable().openapi({ description: 'Project page' }),
    manual_download: z.boolean().openapi({ description: 'No direct file link: send the user to source_url' }),
    tags: z.array(z.string()),
    cover_url: z.string().nullable().openapi({ description: 'Best image for a card: manifest screenshot, preview, found image or game cover' }),
    media: z.array(MediaDto).openapi({ description: 'Gallery images (not part of a preview pair)' }),
    previews: z.array(PreviewDto),
    requires: z.array(z.string()),
    devices: z.array(z.string()),
    stars: z.number().nullable(),
    targets: z.array(TargetDto),
    install: z.array(InstallStepDto),
    latest_release: ReleaseDto.nullable(),
    updated_at: z.string(),
  })
  .openapi('Mod');

export const LookupDto = z
  .object({
    game: GameDto,
    matched: z.object({ kind: z.string(), value: z.string() }),
    mods: z.array(ModDto),
  })
  .openapi('LookupResult');

export const PlatformDto = z
  .object({ id: z.string(), name: z.string(), manufacturer: z.string().nullable(), kind: z.string(), screens: z.number() })
  .openapi('Platform');

export const EmulatorDto = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    platforms: z.array(z.string()),
    os: z.array(z.string()),
    homepage: z.string().nullable(),
    paths: z.record(z.string(), z.string()).nullable(),
  })
  .openapi('Emulator');

export const DeviceDto = z
  .object({
    id: z.string(),
    name: z.string(),
    manufacturer: z.string(),
    os: z.string(),
    screens: z.number(),
    resolutions: z.array(z.string()).nullable(),
  })
  .openapi('Device');

export const ErrorDto = z.object({ error: z.string() }).openapi('Error');

export const page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), next_offset: z.number().nullable() });

export type GameDto = z.infer<typeof GameDto>;
export type ModDto = z.infer<typeof ModDto>;
export type ReleaseDto = z.infer<typeof ReleaseDto>;
export type MediaDto = z.infer<typeof MediaDto>;
