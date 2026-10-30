CREATE TABLE "game_media" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"width" integer,
	"height" integer,
	"position" smallint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_identifiers" ADD COLUMN "source" text DEFAULT 'manifest' NOT NULL;--> statement-breakpoint
ALTER TABLE "game_identifiers" ADD COLUMN "sibling_of" text;--> statement-breakpoint
ALTER TABLE "game_media" ADD CONSTRAINT "game_media_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_media_game_idx" ON "game_media" USING btree ("game_id");