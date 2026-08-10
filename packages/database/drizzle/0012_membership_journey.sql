CREATE TABLE "member_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"customer_persona_id" uuid NOT NULL,
	"growth_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_profiles_sandbox_customer_unique" UNIQUE("sandbox_id", "customer_persona_id"),
	CONSTRAINT "member_profiles_non_negative_growth" CHECK ("growth_points" >= 0),
	CONSTRAINT "member_profiles_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "member_profiles_customer_persona_id_demo_personas_id_fk" FOREIGN KEY ("customer_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "member_growth_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"member_profile_id" uuid NOT NULL,
	"customer_persona_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid,
	"final_simulated_amount_cents" integer NOT NULL,
	"growth_points" integer NOT NULL,
	"business_occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_growth_events_source_kind" CHECK ("source_kind" IN ('seed-baseline', 'reservation', 'order')),
	CONSTRAINT "member_growth_events_source_reference" CHECK (("source_kind" = 'seed-baseline' AND "source_id" IS NULL) OR ("source_kind" <> 'seed-baseline' AND "source_id" IS NOT NULL)),
	CONSTRAINT "member_growth_events_non_negative_amounts" CHECK ("final_simulated_amount_cents" >= 0 AND "growth_points" >= 0),
	CONSTRAINT "member_growth_events_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "member_growth_events_member_profile_id_member_profiles_id_fk" FOREIGN KEY ("member_profile_id") REFERENCES "public"."member_profiles"("id") ON DELETE cascade,
	CONSTRAINT "member_growth_events_customer_persona_id_demo_personas_id_fk" FOREIGN KEY ("customer_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_growth_events_business_source_unique" ON "member_growth_events" ("sandbox_id", "customer_persona_id", "source_kind", "source_id") WHERE "source_id" IS NOT NULL;
CREATE UNIQUE INDEX "member_growth_events_seed_baseline_unique" ON "member_growth_events" ("sandbox_id", "customer_persona_id", "source_kind") WHERE "source_kind" = 'seed-baseline';
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
	"member_profiles",
	"member_growth_events"
TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "member_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "member_profiles_isolate_by_sandbox" ON "member_profiles"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "member_growth_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member_growth_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "member_growth_events_isolate_by_sandbox" ON "member_growth_events"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '9', "updated_at" = now() WHERE "key" = 'schema_version';
