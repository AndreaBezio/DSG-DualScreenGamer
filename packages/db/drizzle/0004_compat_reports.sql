CREATE TABLE "compat_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"mod_id" text NOT NULL,
	"user_id" text NOT NULL,
	"version" text NOT NULL,
	"device" text NOT NULL,
	"firmware" text,
	"emulator" text,
	"emulator_version" text,
	"result" text NOT NULL,
	"note" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compat_reports" ADD CONSTRAINT "compat_reports_mod_id_mods_id_fk" FOREIGN KEY ("mod_id") REFERENCES "public"."mods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compat_reports" ADD CONSTRAINT "compat_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "compat_reports_uq" ON "compat_reports" USING btree ("mod_id","user_id","version","device");--> statement-breakpoint
CREATE INDEX "compat_reports_mod_idx" ON "compat_reports" USING btree ("mod_id");