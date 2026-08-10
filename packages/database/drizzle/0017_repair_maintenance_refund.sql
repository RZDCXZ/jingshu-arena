ALTER TABLE "repairs"
	ADD COLUMN "assigned_to_persona_id" uuid,
	ADD COLUMN "assigned_business_at" timestamp with time zone,
	ADD COLUMN "processing_business_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "repairs"
	ADD CONSTRAINT "repairs_assigned_to_persona_id_demo_personas_id_fk"
	FOREIGN KEY ("assigned_to_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "repairs"
	ADD CONSTRAINT "repairs_assignment_state"
	CHECK (
		("status" = 'new' AND "assigned_to_persona_id" IS NULL AND "assigned_business_at" IS NULL)
		OR
		("status" <> 'new' AND "assigned_to_persona_id" IS NOT NULL AND "assigned_business_at" IS NOT NULL)
	);
--> statement-breakpoint
CREATE TABLE "repair_state_command_requests" (
	"sandbox_id" uuid NOT NULL,
	"actor_persona_id" uuid NOT NULL,
	"repair_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_state_command_requests_pk" PRIMARY KEY("sandbox_id", "actor_persona_id", "command_type", "idempotency_key_hash"),
	CONSTRAINT "repair_state_command_requests_type" CHECK ("command_type" IN ('assign', 'start')),
	CONSTRAINT "repair_state_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "repair_state_command_requests_actor_persona_id_demo_personas_id_fk" FOREIGN KEY ("actor_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade,
	CONSTRAINT "repair_state_command_requests_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "repair_state_command_requests" TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "repair_state_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repair_state_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "repair_state_command_requests_isolate_by_sandbox" ON "repair_state_command_requests"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '14', "updated_at" = now() WHERE "key" = 'schema_version';
