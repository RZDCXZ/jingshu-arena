CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE TABLE "experience_coupons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"customer_persona_id" uuid NOT NULL,
	"store_id" uuid,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"business_kind" text NOT NULL,
	"discount_cents" integer NOT NULL,
	"minimum_spend_cents" integer NOT NULL,
	"eligible_start_minutes" integer NOT NULL,
	"eligible_end_minutes" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"reserved_reservation_id" uuid,
	"reserved_until" timestamp with time zone,
	CONSTRAINT "experience_coupons_sandbox_code_unique" UNIQUE("sandbox_id", "code"),
	CONSTRAINT "experience_coupons_business_kind" CHECK ("business_kind" IN ('reservation', 'order')),
	CONSTRAINT "experience_coupons_non_negative_amounts" CHECK ("discount_cents" >= 0 AND "minimum_spend_cents" >= 0),
	CONSTRAINT "experience_coupons_time_minutes" CHECK ("eligible_start_minutes" >= 0 AND "eligible_start_minutes" < 1440 AND "eligible_end_minutes" > 0 AND "eligible_end_minutes" <= 1440),
	CONSTRAINT "experience_coupons_valid_range" CHECK ("valid_until" > "valid_from"),
	CONSTRAINT "experience_coupons_status" CHECK ("status" IN ('available', 'reserved', 'redeemed', 'expired')),
	CONSTRAINT "experience_coupons_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "experience_coupons_customer_persona_id_demo_personas_id_fk" FOREIGN KEY ("customer_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade,
	CONSTRAINT "experience_coupons_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict
);
--> statement-breakpoint
ALTER TABLE "reservations"
	ADD COLUMN "hold_expires_at" timestamp with time zone,
	ADD COLUMN "created_business_at" timestamp with time zone,
	ADD COLUMN "price_snapshot" jsonb,
	ADD COLUMN "coupon_id" uuid,
	ADD COLUMN "coupon_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "reservations"
	ADD CONSTRAINT "reservations_coupon_id_experience_coupons_id_fk"
	FOREIGN KEY ("coupon_id") REFERENCES "public"."experience_coupons"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "reservations"
	ADD CONSTRAINT "reservations_pending_snapshot"
	CHECK ("status" <> 'pending-confirmation' OR ("hold_expires_at" IS NOT NULL AND "created_business_at" IS NOT NULL AND "price_snapshot" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "reservations"
	ADD CONSTRAINT "reservations_active_seat_range_excl"
	EXCLUDE USING gist (
		"sandbox_id" WITH =,
		"seat_id" WITH =,
		tstzrange("starts_at", "ends_at", '[)') WITH &&
	)
	WHERE ("status" IN ('pending-confirmation', 'confirmed', 'arrived', 'in-use'));
--> statement-breakpoint
ALTER TABLE "reservations"
	ADD CONSTRAINT "reservations_active_customer_range_excl"
	EXCLUDE USING gist (
		"sandbox_id" WITH =,
		"customer_persona_id" WITH =,
		tstzrange("starts_at", "ends_at", '[)') WITH &&
	)
	WHERE ("status" IN ('pending-confirmation', 'confirmed', 'arrived', 'in-use'));
--> statement-breakpoint
CREATE TABLE "reservation_business_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_data" jsonb NOT NULL,
	"business_occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_business_events_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "reservation_business_events_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "reservation_command_requests" (
	"sandbox_id" uuid NOT NULL,
	"customer_persona_id" uuid NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"reservation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_command_requests_pk" PRIMARY KEY("sandbox_id", "customer_persona_id", "idempotency_key_hash"),
	CONSTRAINT "reservation_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "reservation_command_requests_customer_persona_id_demo_personas_id_fk" FOREIGN KEY ("customer_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade,
	CONSTRAINT "reservation_command_requests_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
	"experience_coupons",
	"reservation_business_events",
	"reservation_command_requests"
TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "experience_coupons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "experience_coupons" FORCE ROW LEVEL SECURITY;
CREATE POLICY "experience_coupons_isolate_by_sandbox" ON "experience_coupons"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "reservation_business_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservation_business_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "reservation_business_events_isolate_by_sandbox" ON "reservation_business_events"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "reservation_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservation_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "reservation_command_requests_isolate_by_sandbox" ON "reservation_command_requests"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '6', "updated_at" = now() WHERE "key" = 'schema_version';
