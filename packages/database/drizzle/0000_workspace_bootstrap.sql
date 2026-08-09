CREATE TABLE "jingshu_schema_metadata" (
	"key" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
INSERT INTO "jingshu_schema_metadata" ("key", "value")
VALUES ('schema_version', '1')
ON CONFLICT ("key") DO UPDATE SET
	"value" = excluded."value",
	"updated_at" = now();
