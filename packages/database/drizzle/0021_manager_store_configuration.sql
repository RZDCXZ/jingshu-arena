ALTER TABLE "stores" ADD COLUMN "fictitious_city" text DEFAULT '栖光市（虚构）' NOT NULL;
ALTER TABLE "stores" ADD COLUMN "introduction" text DEFAULT '竞枢固定虚构演示门店。' NOT NULL;
ALTER TABLE "stores" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "stores" ADD CONSTRAINT "stores_positive_config_version" CHECK ("config_version" > 0);
--> statement-breakpoint
ALTER TABLE "store_areas" ADD COLUMN "lifecycle_status" text DEFAULT 'active' NOT NULL;
ALTER TABLE "store_areas" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "store_areas" ADD CONSTRAINT "store_areas_lifecycle_status" CHECK ("lifecycle_status" IN ('active', 'archived', 'draft'));
ALTER TABLE "store_areas" ADD CONSTRAINT "store_areas_positive_config_version" CHECK ("config_version" > 0);
--> statement-breakpoint
ALTER TABLE "seats" ADD COLUMN "lifecycle_status" text DEFAULT 'active' NOT NULL;
ALTER TABLE "seats" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "seats" ADD CONSTRAINT "seats_lifecycle_status" CHECK ("lifecycle_status" IN ('active', 'inactive', 'draft'));
ALTER TABLE "seats" ADD CONSTRAINT "seats_positive_config_version" CHECK ("config_version" > 0);
--> statement-breakpoint
CREATE TABLE "store_business_hours_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "sandbox_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "day_set" text NOT NULL,
  "opens_at" time NOT NULL,
  "closes_at" time NOT NULL,
  "closes_next_day" boolean DEFAULT false NOT NULL,
  "is_open_24_hours" boolean DEFAULT false NOT NULL,
  "effective_from" timestamp with time zone NOT NULL,
  "created_by_persona_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "store_business_hours_scope_effective_unique" UNIQUE("sandbox_id", "store_id", "day_set", "effective_from"),
  CONSTRAINT "store_business_hours_day_set" CHECK ("day_set" IN ('all', 'weekdays', 'weekends')),
  CONSTRAINT "store_business_hours_versions_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "store_business_hours_versions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict,
  CONSTRAINT "store_business_hours_versions_persona_id_demo_personas_id_fk" FOREIGN KEY ("created_by_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "store_config_command_requests" (
  "sandbox_id" uuid NOT NULL,
  "actor_persona_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "command_type" text NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "payload_hash" text NOT NULL,
  "result_data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "store_config_command_requests_pk" PRIMARY KEY("sandbox_id", "actor_persona_id", "idempotency_key_hash"),
  CONSTRAINT "store_config_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "store_config_command_requests_persona_id_demo_personas_id_fk" FOREIGN KEY ("actor_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade,
  CONSTRAINT "store_config_command_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict
);
--> statement-breakpoint
GRANT SELECT, UPDATE ON TABLE "stores", "store_areas", "seats" TO jingshu_runtime;
GRANT SELECT, INSERT ON TABLE "store_business_hours_versions", "store_config_command_requests" TO jingshu_runtime;
GRANT DELETE ON TABLE "store_areas", "seats" TO jingshu_runtime;
ALTER TABLE "store_business_hours_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_business_hours_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "store_business_hours_versions_isolate_by_sandbox" ON "store_business_hours_versions"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "store_config_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_config_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "store_config_command_requests_isolate_by_sandbox" ON "store_config_command_requests"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '18', "updated_at" = now() WHERE "key" = 'schema_version';
