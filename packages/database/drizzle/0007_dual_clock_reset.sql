ALTER TABLE "sandboxes" ADD COLUMN "business_time_anchor_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "business_time_anchor_wall_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "business_time_advance_ms" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "sandboxes"
   SET "business_time_anchor_at" = "created_at",
       "business_time_anchor_wall_at" = "created_at";
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "invalidated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "replaced_by_sandbox_id" uuid;
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_business_time_advance_range" CHECK ("business_time_advance_ms" >= 0 AND "business_time_advance_ms" <= 86400000);
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_replaced_by_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("replaced_by_sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "business_occurred_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "audit_events" SET "business_occurred_at" = "recorded_at" WHERE "business_occurred_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "sandbox_command_requests" (
	"sandbox_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_command_requests_pk" PRIMARY KEY("sandbox_id", "command_type", "idempotency_key_hash"),
	CONSTRAINT "sandbox_command_requests_command_type" CHECK ("command_type" IN ('demo_time.advance', 'sandbox.reset')),
	CONSTRAINT "sandbox_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "sandbox_command_requests" TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "sandbox_command_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sandbox_command_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "sandbox_command_requests_isolate_by_sandbox" ON "sandbox_command_requests"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '4', "updated_at" = now() WHERE "key" = 'schema_version';
