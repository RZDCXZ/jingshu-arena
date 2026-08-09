ALTER TABLE "reservations"
	ADD COLUMN "simulated_payment_cents" integer,
	ADD COLUMN "confirmed_business_at" timestamp with time zone,
	ADD COLUMN "cancelled_business_at" timestamp with time zone,
	ADD COLUMN "expired_business_at" timestamp with time zone,
	ADD COLUMN "terminal_reason" text;
--> statement-breakpoint
ALTER TABLE "reservation_business_events"
	ADD COLUMN "sequence" bigserial NOT NULL;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "reservation_business_events_sequence_seq"
TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "reservations"
	ADD CONSTRAINT "reservations_non_negative_simulated_payment"
	CHECK ("simulated_payment_cents" IS NULL OR "simulated_payment_cents" >= 0);
--> statement-breakpoint
CREATE TABLE "reservation_simulated_refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"business_occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_simulated_refunds_reservation_unique" UNIQUE("sandbox_id", "reservation_id"),
	CONSTRAINT "reservation_simulated_refunds_non_negative_amount" CHECK ("amount_cents" >= 0),
	CONSTRAINT "reservation_simulated_refunds_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "reservation_simulated_refunds_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "reservation_lifecycle_command_requests" (
	"sandbox_id" uuid NOT NULL,
	"customer_persona_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_lifecycle_command_requests_pk" PRIMARY KEY("sandbox_id", "customer_persona_id", "command_type", "idempotency_key_hash"),
	CONSTRAINT "reservation_lifecycle_command_requests_type" CHECK ("command_type" IN ('simulate-payment', 'cancel')),
	CONSTRAINT "reservation_lifecycle_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "reservation_lifecycle_command_requests_customer_persona_id_demo_personas_id_fk" FOREIGN KEY ("customer_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade,
	CONSTRAINT "reservation_lifecycle_command_requests_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
	"reservation_simulated_refunds",
	"reservation_lifecycle_command_requests"
TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "reservation_simulated_refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservation_simulated_refunds" FORCE ROW LEVEL SECURITY;
CREATE POLICY "reservation_simulated_refunds_isolate_by_sandbox" ON "reservation_simulated_refunds"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "reservation_lifecycle_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservation_lifecycle_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "reservation_lifecycle_command_requests_isolate_by_sandbox" ON "reservation_lifecycle_command_requests"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '7', "updated_at" = now() WHERE "key" = 'schema_version';
