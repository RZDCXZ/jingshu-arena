ALTER TABLE "reservations"
	ADD COLUMN "arrived_business_at" timestamp with time zone,
	ADD COLUMN "started_business_at" timestamp with time zone,
	ADD COLUMN "completed_business_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "demo_personas"
	DROP CONSTRAINT "demo_personas_sandbox_role_unique";
CREATE UNIQUE INDEX "demo_personas_protected_sandbox_role_unique"
	ON "demo_personas" ("sandbox_id", "role") WHERE "protected" = true;
--> statement-breakpoint
CREATE TABLE "reservation_frontline_command_requests" (
	"sandbox_id" uuid NOT NULL,
	"actor_persona_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_frontline_command_requests_pk" PRIMARY KEY("sandbox_id", "actor_persona_id", "command_type", "idempotency_key_hash"),
	CONSTRAINT "reservation_frontline_command_requests_type" CHECK ("command_type" IN ('arrive', 'start-use', 'complete-early', 'cancel')),
	CONSTRAINT "reservation_frontline_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "reservation_frontline_command_requests_actor_persona_id_demo_personas_id_fk" FOREIGN KEY ("actor_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade,
	CONSTRAINT "reservation_frontline_command_requests_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
	"reservation_frontline_command_requests"
TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "reservation_frontline_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservation_frontline_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "reservation_frontline_command_requests_isolate_by_sandbox" ON "reservation_frontline_command_requests"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '8', "updated_at" = now() WHERE "key" = 'schema_version';
