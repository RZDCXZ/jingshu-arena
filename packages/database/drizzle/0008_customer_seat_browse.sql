CREATE TABLE "machine_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"experience_description" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "machine_profiles_sandbox_code_unique" UNIQUE("sandbox_id", "code"),
	CONSTRAINT "machine_profiles_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "store_areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "store_areas_sandbox_store_code_unique" UNIQUE("sandbox_id", "store_id", "code"),
	CONSTRAINT "store_areas_positive_sort_order" CHECK ("sort_order" >= 0),
	CONSTRAINT "store_areas_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "store_areas_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "seats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"machine_profile_id" uuid NOT NULL,
	"code" text NOT NULL,
	"sort_order" integer NOT NULL,
	"operational_status" text DEFAULT 'normal' NOT NULL,
	CONSTRAINT "seats_sandbox_store_code_unique" UNIQUE("sandbox_id", "store_id", "code"),
	CONSTRAINT "seats_operational_status" CHECK ("operational_status" IN ('normal', 'maintenance')),
	CONSTRAINT "seats_positive_sort_order" CHECK ("sort_order" >= 0),
	CONSTRAINT "seats_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "seats_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "seats_area_id_store_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."store_areas"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "seats_machine_profile_id_machine_profiles_id_fk" FOREIGN KEY ("machine_profile_id") REFERENCES "public"."machine_profiles"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "price_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"machine_profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"base_hourly_cents" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "price_plans_scope_version_unique" UNIQUE("sandbox_id", "store_id", "area_id", "machine_profile_id", "version"),
	CONSTRAINT "price_plans_positive_version" CHECK ("version" > 0),
	CONSTRAINT "price_plans_non_negative_base_price" CHECK ("base_hourly_cents" >= 0),
	CONSTRAINT "price_plans_effective_range" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
	CONSTRAINT "price_plans_status" CHECK ("status" IN ('active', 'archived')),
	CONSTRAINT "price_plans_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "price_plans_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "price_plans_area_id_store_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."store_areas"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "price_plans_machine_profile_id_machine_profiles_id_fk" FOREIGN KEY ("machine_profile_id") REFERENCES "public"."machine_profiles"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_persona_id" uuid NOT NULL,
	"seat_id" uuid NOT NULL,
	"status" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reservations_time_range" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "reservations_status" CHECK ("status" IN ('pending-confirmation', 'confirmed', 'arrived', 'in-use', 'completed', 'cancelled', 'expired')),
	CONSTRAINT "reservations_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "reservations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "reservations_customer_persona_id_demo_personas_id_fk" FOREIGN KEY ("customer_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "reservations_seat_id_seats_id_fk" FOREIGN KEY ("seat_id") REFERENCES "public"."seats"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "reservations_seat_time_idx" ON "reservations" USING btree ("sandbox_id", "seat_id", "starts_at", "ends_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
	"machine_profiles",
	"store_areas",
	"seats",
	"price_plans",
	"reservations"
TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "machine_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "machine_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "machine_profiles_isolate_by_sandbox" ON "machine_profiles"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "store_areas" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "store_areas" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "store_areas_isolate_by_sandbox" ON "store_areas"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "seats" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "seats" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "seats_isolate_by_sandbox" ON "seats"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "price_plans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "price_plans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "price_plans_isolate_by_sandbox" ON "price_plans"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reservations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "reservations_isolate_by_sandbox" ON "reservations"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '5', "updated_at" = now() WHERE "key" = 'schema_version';
