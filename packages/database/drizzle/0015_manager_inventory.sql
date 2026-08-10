ALTER TABLE "inventory_movements" ADD COLUMN "movement_kind" text;
ALTER TABLE "inventory_movements" ADD COLUMN "compensates_movement_id" uuid;
UPDATE "inventory_movements"
   SET "movement_kind" = CASE
     WHEN "reason" = 'order-waste' THEN 'waste'
     ELSE 'sale'
   END;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_kind" CHECK ("movement_kind" IN ('receipt', 'stocktake', 'compensation', 'sale', 'waste', 'spare-usage', 'spare-return'));
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_compensates_movement_id_fk" FOREIGN KEY ("compensates_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "inventory_command_requests" (
	"sandbox_id" uuid NOT NULL,
	"actor_persona_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_command_requests_pk" PRIMARY KEY("sandbox_id", "actor_persona_id", "idempotency_key_hash"),
	CONSTRAINT "inventory_command_requests_type" CHECK ("command_type" IN ('receipt', 'stocktake', 'compensation')),
	CONSTRAINT "inventory_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
	CONSTRAINT "inventory_command_requests_actor_persona_id_demo_personas_id_fk" FOREIGN KEY ("actor_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade,
	CONSTRAINT "inventory_command_requests_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory_command_requests" TO jingshu_runtime;
ALTER TABLE "inventory_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_command_requests_isolate_by_sandbox" ON "inventory_command_requests" USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid) WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '12', "updated_at" = now() WHERE "key" = 'schema_version';
