ALTER TABLE "products" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "products" ADD CONSTRAINT "products_positive_config_version" CHECK ("config_version" > 0);
ALTER TABLE "machine_profiles" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "machine_profiles" ADD CONSTRAINT "machine_profiles_positive_config_version" CHECK ("config_version" > 0);
ALTER TABLE "repairs" ADD COLUMN "machine_profile_snapshot" jsonb;
UPDATE "repairs" repair
   SET "machine_profile_snapshot" = jsonb_build_object(
     'code', profile.code,
     'displayName', profile.display_name,
     'experienceDescription', profile.experience_description
   )
  FROM "machine_profiles" profile
 WHERE profile.id = repair.machine_profile_id;
CREATE FUNCTION "capture_repair_machine_profile_snapshot"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.machine_profile_snapshot IS NULL THEN
    SELECT jsonb_build_object(
      'code', profile.code,
      'displayName', profile.display_name,
      'experienceDescription', profile.experience_description
    )
      INTO NEW.machine_profile_snapshot
      FROM machine_profiles profile
     WHERE profile.id = NEW.machine_profile_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "repairs_capture_machine_profile_snapshot"
BEFORE INSERT ON "repairs"
FOR EACH ROW EXECUTE FUNCTION "capture_repair_machine_profile_snapshot"();
ALTER TABLE "repairs" ALTER COLUMN "machine_profile_snapshot" SET NOT NULL;
ALTER TABLE "repairs" ADD CONSTRAINT "repairs_machine_profile_snapshot_shape" CHECK (
  jsonb_typeof("machine_profile_snapshot") = 'object'
  AND coalesce("machine_profile_snapshot"->>'code', '') <> ''
  AND coalesce("machine_profile_snapshot"->>'displayName', '') <> ''
  AND coalesce("machine_profile_snapshot"->>'experienceDescription', '') <> ''
);
--> statement-breakpoint
CREATE TABLE "product_store_scopes" (
  "sandbox_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  CONSTRAINT "product_store_scopes_pk" PRIMARY KEY("sandbox_id", "product_id", "store_id"),
  CONSTRAINT "product_store_scopes_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "product_store_scopes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade,
  CONSTRAINT "product_store_scopes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "headquarters_catalog_command_requests" (
  "sandbox_id" uuid NOT NULL,
  "actor_persona_id" uuid NOT NULL,
  "command_type" text NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "payload_hash" text NOT NULL,
  "result_data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "headquarters_catalog_command_requests_pk" PRIMARY KEY("sandbox_id", "actor_persona_id", "idempotency_key_hash"),
  CONSTRAINT "headquarters_catalog_command_requests_type" CHECK ("command_type" IN ('create-product', 'update-product', 'archive-product', 'create-machine-profile', 'update-machine-profile', 'archive-machine-profile')),
  CONSTRAINT "headquarters_catalog_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "headquarters_catalog_command_requests_persona_id_demo_personas_id_fk" FOREIGN KEY ("actor_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO "product_store_scopes" ("sandbox_id", "product_id", "store_id")
SELECT product.sandbox_id, product.id, store.id
  FROM products product
  JOIN stores store ON store.sandbox_id = product.sandbox_id;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "product_store_scopes", "headquarters_catalog_command_requests" TO jingshu_runtime;
GRANT SELECT, UPDATE ON TABLE "products", "machine_profiles" TO jingshu_runtime;
ALTER TABLE "product_store_scopes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_store_scopes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "product_store_scopes_isolate_by_sandbox" ON "product_store_scopes"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "headquarters_catalog_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "headquarters_catalog_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "headquarters_catalog_commands_isolate_by_sandbox" ON "headquarters_catalog_command_requests"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '22', "updated_at" = now() WHERE "key" = 'schema_version';
