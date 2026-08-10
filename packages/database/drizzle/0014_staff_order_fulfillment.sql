ALTER TABLE "customer_orders" DROP CONSTRAINT "customer_orders_status";
--> statement-breakpoint
ALTER TABLE "customer_orders" ADD COLUMN "preparing_business_at" timestamp with time zone;
ALTER TABLE "customer_orders" ADD COLUMN "ready_business_at" timestamp with time zone;
ALTER TABLE "customer_orders" ADD COLUMN "completed_business_at" timestamp with time zone;
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_status" CHECK ("status" IN ('pending-simulated-payment', 'simulated-paid', 'preparing', 'ready-for-pickup', 'completed', 'cancelled', 'expired'));
--> statement-breakpoint
ALTER TABLE "order_inventory_reservations" DROP CONSTRAINT "order_inventory_reservations_status";
ALTER TABLE "order_inventory_reservations" ADD CONSTRAINT "order_inventory_reservations_status" CHECK ("status" IN ('active', 'released', 'sold', 'wasted'));
--> statement-breakpoint
CREATE TABLE "order_simulated_refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"business_occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_simulated_refunds_order_unique" UNIQUE("sandbox_id", "order_id"),
	CONSTRAINT "order_simulated_refunds_non_negative_amount" CHECK ("amount_cents" >= 0),
	CONSTRAINT "order_simulated_refunds_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "order_simulated_refunds_order_id_customer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_orders"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "order_frontline_command_requests" (
	"sandbox_id" uuid NOT NULL,
	"actor_persona_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_frontline_command_requests_pk" PRIMARY KEY("sandbox_id", "actor_persona_id", "idempotency_key_hash"),
	CONSTRAINT "order_frontline_command_requests_type" CHECK ("command_type" IN ('start-preparing', 'mark-ready', 'complete', 'cancel')),
	CONSTRAINT "order_frontline_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "order_frontline_command_requests_actor_persona_id_demo_personas_id_fk" FOREIGN KEY ("actor_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade,
	CONSTRAINT "order_frontline_command_requests_order_id_customer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_orders"("id") ON DELETE cascade
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
	"order_simulated_refunds",
	"order_frontline_command_requests"
TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "order_simulated_refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_simulated_refunds" FORCE ROW LEVEL SECURITY;
CREATE POLICY "order_simulated_refunds_isolate_by_sandbox" ON "order_simulated_refunds" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "order_frontline_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_frontline_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "order_frontline_command_requests_isolate_by_sandbox" ON "order_frontline_command_requests" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '11', "updated_at" = now() WHERE "key" = 'schema_version';
