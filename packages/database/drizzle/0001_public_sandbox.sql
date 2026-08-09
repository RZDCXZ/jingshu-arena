CREATE TABLE "sandboxes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schema_version" text NOT NULL,
	"seed_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sandboxes_expiry_after_creation" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"city" text NOT NULL,
	CONSTRAINT "operators_sandbox_unique" UNIQUE("sandbox_id")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"seat_count" integer NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	"closes_next_day" boolean DEFAULT false NOT NULL,
	"is_open_24_hours" boolean DEFAULT false NOT NULL,
	CONSTRAINT "stores_sandbox_code_unique" UNIQUE("sandbox_id", "code"),
	CONSTRAINT "stores_positive_seat_count" CHECK ("seat_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "demo_personas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"store_id" uuid,
	"role" text NOT NULL,
	"display_name" text NOT NULL,
	"scope" text NOT NULL,
	"protected" boolean DEFAULT true NOT NULL,
	CONSTRAINT "demo_personas_sandbox_role_unique" UNIQUE("sandbox_id", "role"),
	CONSTRAINT "demo_personas_public_role" CHECK ("role" IN ('customer', 'staff', 'manager', 'hq'))
);
--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "operators_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "demo_personas" ADD CONSTRAINT "demo_personas_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "demo_personas" ADD CONSTRAINT "demo_personas_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '2', "updated_at" = now() WHERE "key" = 'schema_version';
