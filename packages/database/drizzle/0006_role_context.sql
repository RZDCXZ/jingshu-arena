ALTER TABLE "sandboxes" ADD COLUMN "role_context_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "role_context_role" text;
--> statement-breakpoint
ALTER TABLE "sandboxes" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sandbox_creation_requests" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE "sandboxes" AS "sandbox"
SET "role_context_role" = COALESCE(
	(
		SELECT "request"."selected_role"
		FROM "sandbox_creation_requests" AS "request"
		WHERE "request"."sandbox_id" = "sandbox"."id"
		ORDER BY "request"."created_at"
		LIMIT 1
	),
	'customer'
);
--> statement-breakpoint
ALTER TABLE "sandbox_creation_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sandboxes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_positive_role_context_version" CHECK ("role_context_version" > 0);
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_public_role_context_role" CHECK ("role_context_role" IN ('customer', 'staff', 'manager', 'hq'));
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"store_id" uuid,
	"persona_id" uuid,
	"role" text NOT NULL,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid,
	"result" text NOT NULL,
	"reason" text,
	"request_id" uuid NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_public_role" CHECK ("role" IN ('customer', 'staff', 'manager', 'hq')),
	CONSTRAINT "audit_events_result" CHECK ("result" IN ('allowed', 'denied')),
	CONSTRAINT "audit_events_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "audit_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "audit_events_persona_id_demo_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "audit_events" TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_events_isolate_by_sandbox" ON "audit_events"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '3', "updated_at" = now() WHERE "key" = 'schema_version';
