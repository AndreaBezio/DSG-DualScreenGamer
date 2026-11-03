import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const platforms = pgTable('platforms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  manufacturer: text('manufacturer'),
  kind: text('kind').notNull(),
  screens: smallint('screens').notNull().default(1),
  /** How other catalogs and frontends name this platform (see registry/catalog/platforms.yaml) */
  externalIds: jsonb('external_ids').$type<PlatformExternalIds>().notNull().default(sql`'{}'`),
});

export type PlatformExternalIds = {
  igdb?: number;
  screenscraper?: number;
  retroachievements?: number[];
  launchbox?: string;
  thegamesdb?: number;
  libretro?: string;
  libretroDat?: 'no-intro' | 'redump';
  aliases?: string[];
};

export const emulators = pgTable('emulators', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  platforms: text('platforms').array().notNull(),
  os: text('os').array().notNull(),
  homepage: text('homepage'),
  paths: jsonb('paths').$type<Record<string, string>>(),
});

export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  manufacturer: text('manufacturer').notNull(),
  os: text('os').notNull(),
  screens: smallint('screens').notNull(),
  resolutions: text('resolutions').array(),
});

export const games = pgTable(
  'games',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    platforms: text('platforms').array().notNull(),
    igdbId: integer('igdb_id'),
    summary: text('summary'),
    coverUrl: text('cover_url'),
    releaseYear: smallint('release_year'),
    metadataSyncedAt: timestamp('metadata_synced_at', { withTimezone: true }),
    origin: text('origin').notNull().default('registry'),
    ownerUserId: text('owner_user_id'),
    ...timestamps,
  },
  (t) => [index('games_title_idx').using('gin', sql`to_tsvector('simple', ${t.title})`)],
);

export const gameIdentifiers = pgTable(
  'game_identifiers',
  {
    id: serial('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    platform: text('platform'),
    region: text('region'),
    label: text('label'),
    /** manifest, or dat when added from a libretro-database DAT */
    source: text('source').notNull().default('manifest'),
    /** For dat rows: the manifest identifier (`kind:value`) of the same dump. */
    siblingOf: text('sibling_of'),
  },
  (t) => [uniqueIndex('game_identifiers_kind_value_uq').on(t.kind, t.value), index('game_identifiers_game_idx').on(t.gameId)],
);

/** Artwork for a game: box art, screenshots, title screens, key art. */
export const gameMedia = pgTable(
  'game_media',
  {
    id: serial('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    /** cover | screenshot | title | artwork */
    kind: text('kind').notNull(),
    url: text('url').notNull(),
    /** igdb | libretro */
    source: text('source').notNull(),
    width: integer('width'),
    height: integer('height'),
    position: smallint('position').notNull(),
  },
  (t) => [index('game_media_game_idx').on(t.gameId)],
);

export type Author = { name: string; github?: string };
export type GithubSource = {
  github: string;
  assets: { role: string; pattern: string }[];
  prereleases: boolean;
  auto_media: boolean;
  tag_pattern?: string;
};
/** Community mods may link files directly instead of following GitHub releases. */
export type ManualSource = { manual: true; page_url?: string };
export type ModSource = GithubSource | ManualSource;

export const isGithubSource = (s: ModSource): s is GithubSource => 'github' in s;

/** registry = YAML manifests in the repo; community = submitted on the website and approved. */
const origin = {
  origin: text('origin').notNull().default('registry'),
  ownerUserId: text('owner_user_id'),
};

export const mods = pgTable(
  'mods',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    summary: text('summary').notNull(),
    description: text('description'),
    gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
    authors: jsonb('authors').$type<Author[]>().notNull(),
    license: text('license').notNull(),
    homepage: text('homepage'),
    tags: text('tags').array().notNull().default(sql`'{}'`),
    requires: text('requires').array().notNull().default(sql`'{}'`),
    devices: text('devices').array().notNull().default(sql`'{}'`),
    source: jsonb('source').$type<ModSource>().notNull(),
    install: jsonb('install').$type<unknown[]>().notNull(),
    stars: integer('stars'),
    lastReleaseAt: timestamp('last_release_at', { withTimezone: true }),
    /** Moderators can hide a mod without deleting it */
    published: boolean('published').notNull().default(true),
    ...origin,
    ...timestamps,
  },
  (t) => [index('mods_game_idx').on(t.gameId), index('mods_type_idx').on(t.type)],
);

export const modTargets = pgTable(
  'mod_targets',
  {
    id: serial('id').primaryKey(),
    modId: text('mod_id')
      .notNull()
      .references(() => mods.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    emulator: text('emulator'),
    minVersion: text('min_version'),
    maxVersion: text('max_version'),
    identifiers: jsonb('identifiers').$type<{ kind: string; value: string }[]>().notNull().default(sql`'[]'`),
  },
  (t) => [index('mod_targets_mod_idx').on(t.modId)],
);

export const modReleases = pgTable(
  'mod_releases',
  {
    id: serial('id').primaryKey(),
    modId: text('mod_id')
      .notNull()
      .references(() => mods.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    version: text('version').notNull(),
    name: text('name'),
    prerelease: boolean('prerelease').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    changelog: text('changelog'),
    htmlUrl: text('html_url').notNull(),
  },
  (t) => [uniqueIndex('mod_releases_mod_tag_uq').on(t.modId, t.tag)],
);

export const releaseAssets = pgTable(
  'release_assets',
  {
    id: serial('id').primaryKey(),
    releaseId: integer('release_id')
      .notNull()
      .references(() => modReleases.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    sha256: text('sha256'),
    contentType: text('content_type'),
    downloadCount: integer('download_count'),
  },
  (t) => [uniqueIndex('release_assets_release_name_uq').on(t.releaseId, t.name)],
);

export const modMedia = pgTable(
  'mod_media',
  {
    id: serial('id').primaryKey(),
    modId: text('mod_id')
      .notNull()
      .references(() => mods.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /** manifest | release | readme | asset */
    source: text('source').notNull(),
    /** gallery | top | bottom */
    kind: text('kind').notNull(),
    /** Index of the top/bottom pair this image belongs to. */
    pair: smallint('pair'),
    caption: text('caption'),
    width: integer('width'),
    height: integer('height'),
    position: smallint('position').notNull(),
  },
  (t) => [index('mod_media_mod_idx').on(t.modId)],
);

/** Small key/value store: GitHub ETags, IGDB token, etc. */
export const syncState = pgTable('sync_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const syncRuns = pgTable('sync_runs', {
  id: serial('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('running'),
  stats: jsonb('stats').$type<Record<string, number>>(),
  errors: jsonb('errors').$type<string[]>(),
});

/* ---------- Accounts and community submissions ---------- */

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  /** user | moderator | admin */
  role: text('role').notNull().default('user'),
  banned: boolean('banned').notNull().default(false),
  ...timestamps,
});

export const userAccounts = pgTable(
  'user_accounts',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** github | discord */
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    username: text('username').notNull(),
  },
  (t) => [uniqueIndex('user_accounts_provider_uq').on(t.provider, t.providerUserId)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** sha256 of the token: a leaked table does not leak sessions */
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** Screenshots uploaded by users, stored as WebP under UPLOAD_DIR/<sha256>.webp */
export const uploads = pgTable(
  'uploads',
  {
    sha256: text('sha256').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('uploads_user_idx').on(t.userId)],
);

export const submissions = pgTable(
  'submissions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Set when the submission edits an already published mod */
    modId: text('mod_id').references(() => mods.id, { onDelete: 'set null' }),
    /** draft | pending | changes_requested | approved | rejected */
    status: text('status').notNull().default('draft'),
    payload: jsonb('payload').notNull(),
    reviewNote: text('review_note'),
    reviewerId: text('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('submissions_status_idx').on(t.status), index('submissions_user_idx').on(t.userId)],
);

/** "Works on my device": one report per user, mod version and device. */
export const compatReports = pgTable(
  'compat_reports',
  {
    id: serial('id').primaryKey(),
    modId: text('mod_id')
      .notNull()
      .references(() => mods.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    device: text('device').notNull(),
    firmware: text('firmware'),
    emulator: text('emulator'),
    emulatorVersion: text('emulator_version'),
    /** works | issues | broken */
    result: text('result').notNull(),
    note: text('note'),
    hidden: boolean('hidden').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('compat_reports_uq').on(t.modId, t.userId, t.version, t.device),
    index('compat_reports_mod_idx').on(t.modId),
  ],
);
