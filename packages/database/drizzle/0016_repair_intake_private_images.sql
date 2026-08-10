CREATE TABLE "repairs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"seat_id" uuid NOT NULL,
	"machine_profile_id" uuid NOT NULL,
	"reservation_id" uuid,
	"customer_persona_id" uuid,
	"created_by_persona_id" uuid NOT NULL,
	"source" text NOT NULL,
	"description" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_business_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repairs_source" CHECK ("source" IN ('customer', 'staff')),
	CONSTRAINT "repairs_priority" CHECK ("priority" IN ('normal', 'high', 'urgent')),
	CONSTRAINT "repairs_status" CHECK ("status" IN ('new', 'assigned', 'processing', 'verification', 'closed')),
	CONSTRAINT "repairs_customer_source" CHECK (("source" = 'customer' AND "customer_persona_id" IS NOT NULL AND "reservation_id" IS NOT NULL) OR ("source" = 'staff' AND "customer_persona_id" IS NULL)),
	CONSTRAINT "repairs_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "repairs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict,
	CONSTRAINT "repairs_seat_id_seats_id_fk" FOREIGN KEY ("seat_id") REFERENCES "public"."seats"("id") ON DELETE restrict,
	CONSTRAINT "repairs_machine_profile_id_machine_profiles_id_fk" FOREIGN KEY ("machine_profile_id") REFERENCES "public"."machine_profiles"("id") ON DELETE restrict,
	CONSTRAINT "repairs_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict,
	CONSTRAINT "repairs_customer_persona_id_demo_personas_id_fk" FOREIGN KEY ("customer_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict,
	CONSTRAINT "repairs_created_by_persona_id_demo_personas_id_fk" FOREIGN KEY ("created_by_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX "repairs_one_open_per_seat_unique" ON "repairs" USING btree ("sandbox_id", "seat_id") WHERE "status" <> 'closed';
--> statement-breakpoint
CREATE TABLE "repair_business_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"repair_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_data" jsonb NOT NULL,
	"sequence" bigserial NOT NULL,
	"business_occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_business_events_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "repair_business_events_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "repair_command_requests" (
	"sandbox_id" uuid NOT NULL,
	"actor_persona_id" uuid NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"repair_id" uuid NOT NULL,
	"result_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_command_requests_pk" PRIMARY KEY("sandbox_id", "actor_persona_id", "idempotency_key_hash"),
	CONSTRAINT "repair_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "repair_command_requests_actor_persona_id_demo_personas_id_fk" FOREIGN KEY ("actor_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade,
	CONSTRAINT "repair_command_requests_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "repair_upload_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"repair_id" uuid NOT NULL,
	"actor_persona_id" uuid NOT NULL,
	"filename_extension" text NOT NULL,
	"declared_content_type" text NOT NULL,
	"declared_size" integer NOT NULL,
	"quarantine_object_key" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"failure_reason" text,
	CONSTRAINT "repair_upload_intents_quarantine_key_unique" UNIQUE("quarantine_object_key"),
	CONSTRAINT "repair_upload_intents_extension" CHECK ("filename_extension" IN ('jpg', 'jpeg', 'png', 'webp')),
	CONSTRAINT "repair_upload_intents_content_type" CHECK ("declared_content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "repair_upload_intents_size" CHECK ("declared_size" > 0 AND "declared_size" <= 5242880),
	CONSTRAINT "repair_upload_intents_status" CHECK ("status" IN ('issued', 'uploading', 'uploaded', 'consumed', 'failed')),
	CONSTRAINT "repair_upload_intents_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "repair_upload_intents_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade,
	CONSTRAINT "repair_upload_intents_actor_persona_id_demo_personas_id_fk" FOREIGN KEY ("actor_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "repair_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"repair_id" uuid NOT NULL,
	"created_by_persona_id" uuid NOT NULL,
	"source" text NOT NULL,
	"content_type" text NOT NULL,
	"object_key" text,
	"sample_asset_id" text,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_images_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "repair_images_source" CHECK ("source" IN ('uploaded', 'sample')),
	CONSTRAINT "repair_images_storage_source" CHECK (("source" = 'uploaded' AND "object_key" IS NOT NULL AND "sample_asset_id" IS NULL) OR ("source" = 'sample' AND "object_key" IS NULL AND "sample_asset_id" IS NOT NULL)),
	CONSTRAINT "repair_images_content_type" CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "repair_images_dimensions" CHECK ("byte_size" > 0 AND "byte_size" <= 5242880 AND "width" > 0 AND "width" <= 4096 AND "height" > 0 AND "height" <= 4096 AND ("width"::bigint * "height"::bigint) <= 16000000),
	CONSTRAINT "repair_images_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "repair_images_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade,
	CONSTRAINT "repair_images_created_by_persona_id_demo_personas_id_fk" FOREIGN KEY ("created_by_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "repair_image_cleanup_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"object_key" text,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"last_failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "repair_image_cleanup_jobs_target" CHECK (("target_kind" = 'object' AND "object_key" IS NOT NULL) OR ("target_kind" = 'sandbox' AND "object_key" IS NULL)),
	CONSTRAINT "repair_image_cleanup_jobs_status" CHECK ("status" IN ('pending', 'completed'))
);
--> statement-breakpoint
CREATE INDEX "repair_image_cleanup_jobs_due_idx" ON "repair_image_cleanup_jobs" USING btree ("status", "available_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
	"repairs", "repair_business_events", "repair_command_requests",
	"repair_upload_intents", "repair_images"
TO jingshu_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "repair_image_cleanup_jobs" TO jingshu_runtime;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE repair_business_events_sequence_seq TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "repairs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repairs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "repairs_isolate_by_sandbox" ON "repairs" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "repair_business_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repair_business_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "repair_business_events_isolate_by_sandbox" ON "repair_business_events" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "repair_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repair_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "repair_command_requests_isolate_by_sandbox" ON "repair_command_requests" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "repair_upload_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repair_upload_intents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "repair_upload_intents_isolate_by_sandbox" ON "repair_upload_intents" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "repair_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repair_images" FORCE ROW LEVEL SECURITY;
CREATE POLICY "repair_images_isolate_by_sandbox" ON "repair_images" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '13', "updated_at" = now() WHERE "key" = 'schema_version';
