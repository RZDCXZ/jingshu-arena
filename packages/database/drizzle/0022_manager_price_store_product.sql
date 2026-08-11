ALTER TABLE "price_plans" ADD COLUMN "starts_at" time DEFAULT '06:00' NOT NULL;
ALTER TABLE "price_plans" ADD COLUMN "ends_at" time DEFAULT '06:00' NOT NULL;
ALTER TABLE "price_plans" ADD COLUMN "ends_next_day" boolean DEFAULT true NOT NULL;
ALTER TABLE "price_plans" ADD COLUMN "weekday_half_hour_cents" integer DEFAULT 0 NOT NULL;
ALTER TABLE "price_plans" ADD COLUMN "weekend_half_hour_cents" integer DEFAULT 0 NOT NULL;
ALTER TABLE "price_plans" ADD COLUMN "pricing_model" text DEFAULT 'legacy' NOT NULL;
ALTER TABLE "price_plans" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "price_plans" DROP CONSTRAINT "price_plans_scope_version_unique";
ALTER TABLE "price_plans" ADD CONSTRAINT "price_plans_scope_version_unique" UNIQUE("sandbox_id", "store_id", "area_id", "machine_profile_id", "starts_at", "ends_at", "ends_next_day", "version");
ALTER TABLE "price_plans" ADD CONSTRAINT "price_plans_non_negative_half_hour_prices" CHECK ("weekday_half_hour_cents" >= 0 AND "weekend_half_hour_cents" >= 0);
ALTER TABLE "price_plans" ADD CONSTRAINT "price_plans_positive_config_version" CHECK ("config_version" > 0);
ALTER TABLE "price_plans" ADD CONSTRAINT "price_plans_pricing_model" CHECK ("pricing_model" IN ('legacy', 'explicit-half-hour'));
ALTER TABLE "price_plans" NO FORCE ROW LEVEL SECURITY;
UPDATE "price_plans"
   SET "weekday_half_hour_cents" = floor(("base_hourly_cents" * 10000 + 10000)::numeric / 20000)::integer,
       "weekend_half_hour_cents" = floor(("base_hourly_cents" * 11500 + 10000)::numeric / 20000)::integer
 WHERE "pricing_model" = 'legacy';
ALTER TABLE "price_plans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;
ALTER TABLE "store_products" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_positive_config_version" CHECK ("config_version" > 0);
--> statement-breakpoint
GRANT UPDATE ON TABLE "price_plans", "store_products", "inventory_items" TO jingshu_runtime;
GRANT INSERT ON TABLE "price_plans" TO jingshu_runtime;
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '19', "updated_at" = now() WHERE "key" = 'schema_version';
