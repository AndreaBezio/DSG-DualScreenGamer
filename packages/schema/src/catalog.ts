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
    /** Resolution of each screen, top/primary first. */
    resolutions: z.array(z.string().regex(/^\d+x\d+$/)).optional(),
  })
  .strict();
export type Device = z.infer<typeof Device>;

export const Catalog = z.object({
  platforms: z.array(Platform),
  emulators: z.array(Emulator),
  devices: z.array(Device),
});
export type Catalog = z.infer<typeof Catalog>;
