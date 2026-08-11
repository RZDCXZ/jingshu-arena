ALTER TABLE "price_plans" ADD COLUMN "starts_at" time DEFAULT '06:00' NOT NULL;
ALTER TABLE "price_plans" ADD COLUMN "ends_at" time DEFAULT '06:00' NOT NULL;
ALTER TABLE "price_plans" ADD COLUMN "ends_next_day" boolean DEFAULT true NOT NULL;
ALTER TABLE "price_plans" ADD COLUMN "weekday_half_hour_cents" integer DEFAULT 0 NOT NULL;
ALTER TABLE "price_plans" ADD COLUMN "weekend_half_hour_cents" integer DEFAULT 0 NOT NULL;
ALTER TABLE "price_plans" ADD COLUMN "pricing_model" text DEFAULT 'legacy' NOT NULL;
ALTER TABLE "price_plans" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "price_plans" ADD CONSTRAINT "price_plans_non_negative_half_hour_prices" CHECK ("weekday_half_hour_cents" >= 0 AND "weekend_half_hour_cents" >= 0);
ALTER TABLE "price_plans" ADD CONSTRAINT "price_plans_positive_config_version" CHECK ("config_version" > 0);
ALTER TABLE "price_plans" ADD CONSTRAINT "price_plans_pricing_model" CHECK ("pricing_model" IN ('legacy', 'explicit-half-hour'));
ALTER TABLE "price_plans" ADD CONSTRAINT "price_plans_scope_effective_unique" UNIQUE("sandbox_id", "store_id", "area_id", "machine_profile_id", "starts_at", "ends_at", "ends_next_day", "effective_from");
--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;
ALTER TABLE "store_products" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_positive_config_version" CHECK ("config_version" > 0);
--> statement-breakpoint
GRANT UPDATE ON TABLE "price_plans", "store_products", "inventory_items" TO jingshu_runtime;
GRANT INSERT ON TABLE "price_plans" TO jingshu_runtime;
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '19', "updated_at" = now() WHERE "key" = 'schema_version';
