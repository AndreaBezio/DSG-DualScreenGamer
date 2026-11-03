import { z } from 'zod';

export const Slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lowercase kebab-case')
  .max(80);

export const Platform = z
  .object({
    id: Slug,
    name: z.string(),
    manufacturer: z.string().optional(),
    kind: z.enum(['handheld', 'console', 'pc', 'mobile', 'arcade']),
    /** Native screen count of the original hardware (DS/3DS/Wii U = 2). */
    screens: z.number().int().min(1).max(2).default(1),
    /** libretro-database DAT used to recognise dumps and find libretro-thumbnails artwork. */
    libretro: z
      .object({ system: z.string(), dat: z.enum(['no-intro', 'redump']) })
      .strict()
      .optional(),
    /** IGDB platform id, used to search games by title. */
    igdb: z.number().int().positive().optional(),
    /** Ids other catalogs and frontends use for this platform; accepted as `platform=` in the API. */
    screenscraper: z.number().int().positive().optional(),
    retroachievements: z.array(z.number().int().positive()).optional(),
    launchbox: z.string().optional(),
    thegamesdb: z.number().int().positive().optional(),
    /** Other short names, e.g. Cocoon's `n3ds`. */
    aliases: z.array(z.string()).default([]),
  })
  .strict();
export type Platform = z.infer<typeof Platform>;

/** Path variables a client must resolve when it runs install steps for this emulator. */
export const EMULATOR_PATH_VARS = ['data_dir', 'load_dir', 'textures_dir', 'mods_dir', 'layouts_dir'] as const;

export const Emulator = z
  .object({
    id: Slug,
    name: z.string(),
    kind: z.enum(['emulator', 'mod_loader', 'frontend', 'native']).default('emulator'),
    platforms: z.array(Slug).min(1),
    os: z.array(z.enum(['android', 'windows', 'linux', 'macos'])).min(1),
    homepage: z.url().optional(),
    paths: z
      .partialRecord(z.enum(EMULATOR_PATH_VARS), z.string())
      .optional()
      .describe('Human description of each path variable, shown to client developers'),
  })
  .strict();
export type Emulator = z.infer<typeof Emulator>;

export const Device = z
  .object({
    id: Slug,
    name: z.string(),
    manufacturer: z.string(),
    os: z.enum(['android', 'windows', 'linux']),
    screens: z.number().int().min(1).max(3),
    chipset: z.string().optional(),
    aliases: z.array(z.string()).default([]),
    /** Each physical screen, top first. Diagonals give the real proportions in previews. */
    displays: z
      .array(
        z
          .object({
            role: z.enum(['top', 'bottom']),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            diagonal_in: z.number().positive().optional(),
            panel: z.enum(['amoled', 'oled', 'ips', 'lcd']).optional(),
            refresh_hz: z.number().int().positive().optional(),
            touch: z.boolean().optional(),
          })
          .strict(),
      )
      .default([]),
    /** Recommended emulator settings for this device; every profile cites where it comes from. */
    profiles: z
      .array(
        z
          .object({
            emulator: Slug,
            note: z.string().optional(),
            settings: z.array(z.object({ name: z.string(), value: z.string(), note: z.string().optional() }).strict()).min(1),
            source_url: z.url(),
          })
          .strict(),
      )
      .default([]),
    /** Where the specs come from */
    sources: z.array(z.url()).default([]),
  })
  .strict();
export type Device = z.infer<typeof Device>;

export const Catalog = z.object({
  platforms: z.array(Platform),
  emulators: z.array(Emulator),
  devices: z.array(Device),
});
export type Catalog = z.infer<typeof Catalog>;
