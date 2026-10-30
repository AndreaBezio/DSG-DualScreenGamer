CREATE TABLE "mod_media" (
	"id" serial PRIMARY KEY NOT NULL,
	"mod_id" text NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"pair" smallint,
	"caption" text,
	"width" integer,
	"height" integer,
	"position" smallint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mod_media" ADD CONSTRAINT "mod_media_mod_id_mods_id_fk" FOREIGN KEY ("mod_id") REFERENCES "public"."mods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mod_media_mod_idx" ON "mod_media" USING btree ("mod_id");--> statement-breakpoint
ALTER TABLE "mods" DROP COLUMN "screenshots";