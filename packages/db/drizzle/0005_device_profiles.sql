ALTER TABLE "devices" ADD COLUMN "chipset" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "aliases" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "displays" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "profiles" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "sources" text[] DEFAULT '{}' NOT NULL;