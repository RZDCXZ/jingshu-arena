ALTER TABLE "employees"
  ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
  "id" uuid PRIMARY KEY,
  "sandbox_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "shift_id" uuid NOT NULL,
  "attendance_record_id" uuid NOT NULL,
  "corrected_by_persona_id" uuid NOT NULL,
  "correction_kind" text NOT NULL,
  "corrected_business_at" timestamp with time zone NOT NULL,
  "reason" text NOT NULL,
  "business_occurred_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "attendance_corrections_kind" CHECK ("correction_kind" IN ('late', 'absence', 'check-out')),
  CONSTRAINT "attendance_corrections_reason" CHECK (char_length("reason") BETWEEN 1 AND 200),
  CONSTRAINT "attendance_corrections_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "attendance_corrections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict,
  CONSTRAINT "attendance_corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict,
  CONSTRAINT "attendance_corrections_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE restrict,
  CONSTRAINT "attendance_corrections_record_id_attendance_records_id_fk" FOREIGN KEY ("attendance_record_id") REFERENCES "public"."attendance_records"("id") ON DELETE restrict,
  CONSTRAINT "attendance_corrections_actor_id_demo_personas_id_fk" FOREIGN KEY ("corrected_by_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "manager_people_command_requests" (
  "sandbox_id" uuid NOT NULL,
  "actor_persona_id" uuid NOT NULL,
  "command_type" text NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "payload_hash" text NOT NULL,
  "result_data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "manager_people_command_requests_pk" PRIMARY KEY("sandbox_id", "actor_persona_id", "command_type", "idempotency_key_hash"),
  CONSTRAINT "manager_people_command_requests_type" CHECK ("command_type" IN ('create-employee', 'update-employee', 'deactivate-employee', 'create-shift', 'update-shift', 'cancel-shift', 'correct-attendance')),
  CONSTRAINT "manager_people_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "manager_people_command_requests_actor_id_demo_personas_id_fk" FOREIGN KEY ("actor_persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_public_employee() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM sandboxes WHERE id = OLD.sandbox_id
  ) THEN
    RETURN OLD;
  END IF;
  IF OLD.protected THEN
    RAISE EXCEPTION 'Protected demo employees are immutable.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "employees_protect_public_persona"
  BEFORE UPDATE OR DELETE ON "employees"
  FOR EACH ROW EXECUTE FUNCTION protect_public_employee();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_attendance_correction() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM sandboxes WHERE id = OLD.sandbox_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Attendance corrections are append-only.' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "attendance_corrections_protect_history"
  BEFORE UPDATE OR DELETE ON "attendance_corrections"
  FOR EACH ROW EXECUTE FUNCTION protect_attendance_correction();
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "attendance_corrections", "manager_people_command_requests" TO jingshu_runtime;
GRANT UPDATE ("employee_code", "display_name", "active", "config_version") ON TABLE "employees" TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "attendance_corrections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_corrections" FORCE ROW LEVEL SECURITY;
CREATE POLICY "attendance_corrections_isolate_by_sandbox" ON "attendance_corrections"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "manager_people_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manager_people_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "manager_people_commands_isolate_by_sandbox" ON "manager_people_command_requests"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '20', "updated_at" = now() WHERE "key" = 'schema_version';
