UPDATE "audit_events"
SET "business_occurred_at" = "recorded_at"
WHERE "business_occurred_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "audit_events"
  ALTER COLUMN "business_occurred_at" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "audit_events_store_business_idx"
  ON "audit_events" ("sandbox_id", "store_id", "business_occurred_at", "id");
CREATE INDEX "audit_events_store_recorded_idx"
  ON "audit_events" ("sandbox_id", "store_id", "recorded_at", "id");
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '21', "updated_at" = now() WHERE "key" = 'schema_version';
