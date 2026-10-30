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
});

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
  },
  (t) => [uniqueIndex('game_identifiers_kind_value_uq').on(t.kind, t.value), index('game_identifiers_game_idx').on(t.gameId)],
);

export type Author = { name: string; github?: string };
export type ModSource = {
  github: string;
  assets: { role: string; pattern: string }[];
  prereleases: boolean;
  tag_pattern?: string;
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
    screenshots: text('screenshots').array().notNull().default(sql`'{}'`),
    requires: text('requires').array().notNull().default(sql`'{}'`),
    devices: text('devices').array().notNull().default(sql`'{}'`),
    source: jsonb('source').$type<ModSource>().notNull(),
    install: jsonb('install').$type<unknown[]>().notNull(),
    stars: integer('stars'),
    lastReleaseAt: timestamp('last_release_at', { withTimezone: true }),
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
