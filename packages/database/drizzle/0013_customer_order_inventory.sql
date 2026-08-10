CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "products_sandbox_code_unique" UNIQUE("sandbox_id", "code"),
	CONSTRAINT "products_category" CHECK ("category" IN ('drink', 'snack', 'meal', 'supply')),
	CONSTRAINT "products_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"on_hand_quantity" integer DEFAULT 0 NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_items_sandbox_store_code_unique" UNIQUE("sandbox_id", "store_id", "code"),
	CONSTRAINT "inventory_items_store_product_unique" UNIQUE("sandbox_id", "store_id", "product_id"),
	CONSTRAINT "inventory_items_kind" CHECK ("kind" IN ('product', 'spare')),
	CONSTRAINT "inventory_items_product_reference" CHECK (("kind" = 'product' AND "product_id" IS NOT NULL) OR ("kind" = 'spare' AND "product_id" IS NULL)),
	CONSTRAINT "inventory_items_quantity_invariants" CHECK ("on_hand_quantity" >= 0 AND "reserved_quantity" >= 0 AND "reserved_quantity" <= "on_hand_quantity" AND "low_stock_threshold" >= 0),
	CONSTRAINT "inventory_items_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "inventory_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade,
	CONSTRAINT "inventory_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "store_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"listed" boolean DEFAULT false NOT NULL,
	"unit_price_cents" integer NOT NULL,
	CONSTRAINT "store_products_sandbox_store_product_unique" UNIQUE("sandbox_id", "store_id", "product_id"),
	CONSTRAINT "store_products_inventory_item_unique" UNIQUE("inventory_item_id"),
	CONSTRAINT "store_products_non_negative_price" CHECK ("unit_price_cents" >= 0),
	CONSTRAINT "store_products_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "store_products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade,
	CONSTRAINT "store_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict,
	CONSTRAINT "store_products_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "customer_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_persona_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"seat_id" uuid NOT NULL,
	"status" text NOT NULL,
	"hold_expires_at" timestamp with time zone NOT NULL,
	"created_business_at" timestamp with time zone NOT NULL,
	"order_snapshot" jsonb NOT NULL,
	"coupon_id" uuid,
	"coupon_snapshot" jsonb,
	"simulated_payment_cents" integer,
	"paid_business_at" timestamp with time zone,
	"cancelled_business_at" timestamp with time zone,
	"expired_business_at" timestamp with time zone,
	"terminal_reason" text,
	CONSTRAINT "customer_orders_status" CHECK ("status" IN ('pending-simulated-payment', 'simulated-paid', 'cancelled', 'expired')),
	CONSTRAINT "customer_orders_non_negative_payment" CHECK ("simulated_payment_cents" IS NULL OR "simulated_payment_cents" >= 0),
	CONSTRAINT "customer_orders_hold_after_creation" CHECK ("hold_expires_at" > "created_business_at"),
	CONSTRAINT "customer_orders_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "customer_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict,
	CONSTRAINT "customer_orders_customer_persona_id_demo_personas_id_fk" FOREIGN KEY ("customer_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict,
	CONSTRAINT "customer_orders_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict,
	CONSTRAINT "customer_orders_seat_id_seats_id_fk" FOREIGN KEY ("seat_id") REFERENCES "public"."seats"("id") ON DELETE restrict,
	CONSTRAINT "customer_orders_coupon_id_experience_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."experience_coupons"("id") ON DELETE restrict
);
--> statement-breakpoint
ALTER TABLE "experience_coupons" ADD COLUMN "reserved_order_id" uuid;
ALTER TABLE "experience_coupons" ADD CONSTRAINT "experience_coupons_reserved_order_id_customer_orders_id_fk" FOREIGN KEY ("reserved_order_id") REFERENCES "public"."customer_orders"("id") ON DELETE restrict;
ALTER TABLE "experience_coupons" ADD CONSTRAINT "experience_coupons_single_reservation" CHECK (NOT ("reserved_reservation_id" IS NOT NULL AND "reserved_order_id" IS NOT NULL));
--> statement-breakpoint
CREATE TABLE "order_inventory_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text NOT NULL,
	"released_business_at" timestamp with time zone,
	CONSTRAINT "order_inventory_reservations_order_item_unique" UNIQUE("sandbox_id", "order_id", "inventory_item_id"),
	CONSTRAINT "order_inventory_reservations_positive_quantity" CHECK ("quantity" > 0),
	CONSTRAINT "order_inventory_reservations_status" CHECK ("status" IN ('active', 'released')),
	CONSTRAINT "order_inventory_reservations_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "order_inventory_reservations_order_id_customer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_orders"("id") ON DELETE cascade,
	CONSTRAINT "order_inventory_reservations_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"order_id" uuid,
	"reason" text NOT NULL,
	"on_hand_delta" integer NOT NULL,
	"on_hand_after" integer NOT NULL,
	"business_occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_non_negative_after" CHECK ("on_hand_after" >= 0),
	CONSTRAINT "inventory_movements_non_zero_delta" CHECK ("on_hand_delta" <> 0),
	CONSTRAINT "inventory_movements_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "inventory_movements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict,
	CONSTRAINT "inventory_movements_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict,
	CONSTRAINT "inventory_movements_order_id_customer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_orders"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "order_business_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_data" jsonb NOT NULL,
	"sequence" bigserial NOT NULL,
	"business_occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_business_events_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "order_business_events_order_id_customer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_orders"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "order_command_requests" (
	"sandbox_id" uuid NOT NULL,
	"customer_persona_id" uuid NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"order_id" uuid NOT NULL,
	"result_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_command_requests_pk" PRIMARY KEY("sandbox_id", "customer_persona_id", "idempotency_key_hash"),
	CONSTRAINT "order_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "order_command_requests_customer_persona_id_demo_personas_id_fk" FOREIGN KEY ("customer_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade,
	CONSTRAINT "order_command_requests_order_id_customer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_orders"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "order_lifecycle_command_requests" (
	"sandbox_id" uuid NOT NULL,
	"customer_persona_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_lifecycle_command_requests_pk" PRIMARY KEY("sandbox_id", "customer_persona_id", "command_type", "idempotency_key_hash"),
	CONSTRAINT "order_lifecycle_command_requests_type" CHECK ("command_type" IN ('simulate-payment', 'cancel')),
	CONSTRAINT "order_lifecycle_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "order_lifecycle_command_requests_customer_persona_id_demo_personas_id_fk" FOREIGN KEY ("customer_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade,
	CONSTRAINT "order_lifecycle_command_requests_order_id_customer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_orders"("id") ON DELETE cascade
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
	"products",
	"inventory_items",
	"store_products",
	"customer_orders",
	"order_inventory_reservations",
	"inventory_movements",
	"order_business_events",
	"order_command_requests",
	"order_lifecycle_command_requests"
TO jingshu_runtime;
GRANT USAGE, SELECT ON SEQUENCE "order_business_events_sequence_seq" TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY "products_isolate_by_sandbox" ON "products" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_items_isolate_by_sandbox" ON "inventory_items" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "store_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_products" FORCE ROW LEVEL SECURITY;
CREATE POLICY "store_products_isolate_by_sandbox" ON "store_products" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "customer_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "customer_orders_isolate_by_sandbox" ON "customer_orders" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "order_inventory_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_inventory_reservations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "order_inventory_reservations_isolate_by_sandbox" ON "order_inventory_reservations" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_movements_isolate_by_sandbox" ON "inventory_movements" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "order_business_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_business_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "order_business_events_isolate_by_sandbox" ON "order_business_events" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "order_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "order_command_requests_isolate_by_sandbox" ON "order_command_requests" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "order_lifecycle_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_lifecycle_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "order_lifecycle_command_requests_isolate_by_sandbox" ON "order_lifecycle_command_requests" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '10', "updated_at" = now() WHERE "key" = 'schema_version';
