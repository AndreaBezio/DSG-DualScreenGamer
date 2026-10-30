CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"manufacturer" text NOT NULL,
	"os" text NOT NULL,
	"screens" smallint NOT NULL,
	"resolutions" text[]
);
--> statement-breakpoint
CREATE TABLE "emulators" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"platforms" text[] NOT NULL,
	"os" text[] NOT NULL,
	"homepage" text,
	"paths" jsonb
);
--> statement-breakpoint
CREATE TABLE "game_identifiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"platform" text,
	"region" text,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"platforms" text[] NOT NULL,
	"igdb_id" integer,
	"summary" text,
	"cover_url" text,
	"release_year" smallint,
	"metadata_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"mod_id" text NOT NULL,
	"tag" text NOT NULL,
	"version" text NOT NULL,
	"name" text,
	"prerelease" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"changelog" text,
	"html_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"mod_id" text NOT NULL,
	"platform" text NOT NULL,
	"emulator" text,
	"min_version" text,
	"max_version" text,
	"identifiers" jsonb DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mods" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"description" text,
	"game_id" text,
	"authors" jsonb NOT NULL,
	"license" text NOT NULL,
	"homepage" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"screenshots" text[] DEFAULT '{}' NOT NULL,
	"requires" text[] DEFAULT '{}' NOT NULL,
	"devices" text[] DEFAULT '{}' NOT NULL,
	"source" jsonb NOT NULL,
	"install" jsonb NOT NULL,
	"stars" integer,
	"last_release_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platforms" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"manufacturer" text,
	"kind" text NOT NULL,
	"screens" smallint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"release_id" integer NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text,
	"content_type" text,
	"download_count" integer
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"stats" jsonb,
	"errors" jsonb
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_identifiers" ADD CONSTRAINT "game_identifiers_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_releases" ADD CONSTRAINT "mod_releases_mod_id_mods_id_fk" FOREIGN KEY ("mod_id") REFERENCES "public"."mods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_targets" ADD CONSTRAINT "mod_targets_mod_id_mods_id_fk" FOREIGN KEY ("mod_id") REFERENCES "public"."mods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mods" ADD CONSTRAINT "mods_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_assets" ADD CONSTRAINT "release_assets_release_id_mod_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."mod_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_identifiers_kind_value_uq" ON "game_identifiers" USING btree ("kind","value");--> statement-breakpoint
CREATE INDEX "game_identifiers_game_idx" ON "game_identifiers" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "games_title_idx" ON "games" USING gin (to_tsvector('simple', "title"));--> statement-breakpoint
CREATE UNIQUE INDEX "mod_releases_mod_tag_uq" ON "mod_releases" USING btree ("mod_id","tag");--> statement-breakpoint
CREATE INDEX "mod_targets_mod_idx" ON "mod_targets" USING btree ("mod_id");--> statement-breakpoint
CREATE INDEX "mods_game_idx" ON "mods" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "mods_type_idx" ON "mods" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "release_assets_release_name_uq" ON "release_assets" USING btree ("release_id","name");