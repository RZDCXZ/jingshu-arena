ALTER TABLE "repairs"
  ADD COLUMN "resolution_note" text,
  ADD COLUMN "resolution_submitted_by_persona_id" uuid,
  ADD COLUMN "resolution_business_at" timestamp with time zone,
  ADD COLUMN "latest_verification_outcome" text,
  ADD COLUMN "latest_verification_reason" text,
  ADD COLUMN "verified_by_persona_id" uuid,
  ADD COLUMN "verification_business_at" timestamp with time zone,
  ADD COLUMN "closed_business_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "repairs"
  ADD CONSTRAINT "repairs_resolution_submitted_by_persona_id_demo_personas_id_fk"
    FOREIGN KEY ("resolution_submitted_by_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict,
  ADD CONSTRAINT "repairs_verified_by_persona_id_demo_personas_id_fk"
    FOREIGN KEY ("verified_by_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict,
  ADD CONSTRAINT "repairs_verification_outcome"
    CHECK ("latest_verification_outcome" IN ('success', 'failure')),
  ADD CONSTRAINT "repairs_resolution_state"
    CHECK ("status" NOT IN ('verification', 'closed') OR ("resolution_note" IS NOT NULL AND "resolution_submitted_by_persona_id" IS NOT NULL AND "resolution_business_at" IS NOT NULL)),
  ADD CONSTRAINT "repairs_closed_state"
    CHECK ("status" <> 'closed' OR ("latest_verification_outcome" = 'success' AND "verified_by_persona_id" IS NOT NULL AND "verification_business_at" IS NOT NULL AND "closed_business_at" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "inventory_movements"
  ADD COLUMN "repair_id" uuid,
  ADD COLUMN "sequence" bigserial NOT NULL;
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_repair_id_repairs_id_fk"
  FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE restrict;
GRANT USAGE, SELECT ON SEQUENCE "inventory_movements_sequence_seq" TO jingshu_runtime;
--> statement-breakpoint
CREATE TABLE "repair_spare_usages" (
  "id" uuid PRIMARY KEY,
  "sandbox_id" uuid NOT NULL,
  "repair_id" uuid NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "claimed_by_persona_id" uuid NOT NULL,
  "inventory_movement_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "returned_quantity" integer DEFAULT 0 NOT NULL,
  "business_occurred_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "repair_spare_usages_movement_unique" UNIQUE("inventory_movement_id"),
  CONSTRAINT "repair_spare_usages_quantity" CHECK ("quantity" > 0),
  CONSTRAINT "repair_spare_usages_returned_quantity" CHECK ("returned_quantity" >= 0 AND "returned_quantity" <= "quantity"),
  CONSTRAINT "repair_spare_usages_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "repair_spare_usages_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE restrict,
  CONSTRAINT "repair_spare_usages_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict,
  CONSTRAINT "repair_spare_usages_claimed_by_persona_id_demo_personas_id_fk" FOREIGN KEY ("claimed_by_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict,
  CONSTRAINT "repair_spare_usages_inventory_movement_id_inventory_movements_id_fk" FOREIGN KEY ("inventory_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "repair_spare_returns" (
  "id" uuid PRIMARY KEY,
  "sandbox_id" uuid NOT NULL,
  "repair_id" uuid NOT NULL,
  "usage_id" uuid NOT NULL,
  "returned_by_persona_id" uuid NOT NULL,
  "inventory_movement_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "business_occurred_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "repair_spare_returns_movement_unique" UNIQUE("inventory_movement_id"),
  CONSTRAINT "repair_spare_returns_quantity" CHECK ("quantity" > 0),
  CONSTRAINT "repair_spare_returns_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "repair_spare_returns_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE restrict,
  CONSTRAINT "repair_spare_returns_usage_id_repair_spare_usages_id_fk" FOREIGN KEY ("usage_id") REFERENCES "public"."repair_spare_usages"("id") ON DELETE restrict,
  CONSTRAINT "repair_spare_returns_returned_by_persona_id_demo_personas_id_fk" FOREIGN KEY ("returned_by_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict,
  CONSTRAINT "repair_spare_returns_inventory_movement_id_inventory_movements_id_fk" FOREIGN KEY ("inventory_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE restrict
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "repair_spare_usages" TO jingshu_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "repair_spare_returns" TO jingshu_runtime;
ALTER TABLE "repair_spare_usages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repair_spare_usages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "repair_spare_usages_isolate_by_sandbox" ON "repair_spare_usages"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "repair_spare_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repair_spare_returns" FORCE ROW LEVEL SECURITY;
CREATE POLICY "repair_spare_returns_isolate_by_sandbox" ON "repair_spare_returns"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "repair_state_command_requests" DROP CONSTRAINT "repair_state_command_requests_type";
ALTER TABLE "repair_state_command_requests" ADD CONSTRAINT "repair_state_command_requests_type"
  CHECK ("command_type" IN ('assign', 'start', 'spare-claim', 'spare-return', 'submit-resolution', 'verify-success', 'verify-failure'));
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '15', "updated_at" = now() WHERE "key" = 'schema_version';
