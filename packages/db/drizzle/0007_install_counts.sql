CREATE TABLE "install_seen" (
	"hash" text PRIMARY KEY NOT NULL,
	"day" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_install_counts" (
	"mod_id" text NOT NULL,
	"day" text NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mod_install_counts_mod_id_day_device_pk" PRIMARY KEY("mod_id","day","device")
);
--> statement-breakpoint
ALTER TABLE "mod_install_counts" ADD CONSTRAINT "mod_install_counts_mod_id_mods_id_fk" FOREIGN KEY ("mod_id") REFERENCES "public"."mods"("id") ON DELETE cascade ON UPDATE no action;