import { z } from 'zod';
import { Slug } from './catalog.ts';
import { Identifier } from './identifiers.ts';
import { AssetRole, InstallStep, ModType, Target } from './manifest.ts';

/** Licenses offered in the submission form. */
export const LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-3-Clause',
  'MPL-2.0',
  'GPL-2.0',
  'GPL-3.0',
  'LGPL-3.0',
  'Unlicense',
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0',
  'All rights reserved',
  'unknown',
] as const;

const https = z.url({ protocol: /^https$/ });

/** An image uploaded through POST /v1/uploads, referenced by its sha256. */
export const UploadRef = z.string().regex(/^[0-9a-f]{64}$/, 'must be an uploaded image');

export const SubmissionGame = z.union([
  z.object({ existing: Slug }).strict(),
  z
    .object({
      new: z
        .object({
          title: z.string().trim().min(1).max(160),
          platforms: z.array(Slug).min(1).max(4),
          identifiers: z.array(Identifier).max(20).default([]),
        })
        .strict(),
    })
    .strict(),
]);

export const ManualFile = z
  .object({
    label: z.string().trim().min(1).max(80),
    role: AssetRole,
    url: https.describe('Direct download link'),
  })
  .strict();

export const SubmissionDownload = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('github'),
      github: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'must be owner/repo'),
      assets: z.array(z.object({ role: AssetRole, pattern: z.string().min(1) }).strict()).min(1).max(5),
      prereleases: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal('manual'),
      version: z.string().trim().min(1).max(40),
      released_at: z.iso.date().optional(),
      changelog: z.string().max(5000).optional(),
      files: z.array(ManualFile).max(10).default([]),
      /** For mods that can't be downloaded directly (e.g. a forum post) */
      page_url: https.optional(),
    })
    .strict()
    .refine((d) => d.files.length > 0 || d.page_url, { message: 'add a file link or a download page', path: ['files'] }),
]);
export type SubmissionDownload = z.infer<typeof SubmissionDownload>;

/** Everything a user enters to list a mod from the website. */
export const CommunitySubmission = z
  .object({
    game: SubmissionGame,
    mod: z
      .object({
        name: z.string().trim().min(1).max(120),
        type: ModType,
        summary: z.string().trim().min(1).max(200),
        description: z.string().max(5000).optional(),
        tags: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
        license: z.enum(LICENSES),
        authors: z
          .array(z.object({ name: z.string().trim().min(1).max(80), github: z.string().max(39).optional() }).strict())
          .min(1)
          .max(10),
        homepage: https.optional(),
        requires: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
        devices: z.array(Slug).max(10).default([]),
      })
      .strict(),
    targets: z.array(Target).min(1).max(10),
    screens: z
      .object({
        pairs: z
          .array(z.object({ top: UploadRef, bottom: UploadRef, caption: z.string().max(140).optional() }).strict())
          .min(1, 'add at least one top + bottom screenshot')
          .max(6),
        gallery: z.array(UploadRef).max(8).default([]),
        cover: UploadRef.optional(),
      })
      .strict(),
    download: SubmissionDownload,
    install: z.array(InstallStep).max(20).default([]),
    consent: z
      .object({
        rights: z.literal(true, { error: 'you must be the author or have permission' }),
        no_game_files: z.literal(true, { error: 'mods must not contain ROMs, BIOS or game files' }),
      })
      .strict(),
  })
  .strict()
  .refine(
    (s) => {
      const roles =
        s.download.kind === 'github' ? s.download.assets.map((a) => a.role) : s.download.files.map((f) => f.role);
      return s.install.every((step) => step.action === 'note' || roles.includes(step.asset));
    },
    { message: 'install step references a file role that is not in the download', path: ['install'] },
  )
  .refine((s) => s.mod.type === 'utility' || 'existing' in s.game || s.game.new.platforms.length > 0, {
    message: 'a game is required',
    path: ['game'],
  });
export type CommunitySubmission = z.infer<typeof CommunitySubmission>;

export const SUBMISSION_STATUSES = ['draft', 'pending', 'changes_requested', 'approved', 'rejected'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
