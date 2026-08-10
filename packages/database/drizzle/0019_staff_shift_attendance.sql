CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE TABLE "employees" (
  "id" uuid PRIMARY KEY,
  "sandbox_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "persona_id" uuid,
  "employee_code" text NOT NULL,
  "display_name" text NOT NULL,
  "role" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "protected" boolean DEFAULT false NOT NULL,
  CONSTRAINT "employees_sandbox_store_code_unique" UNIQUE("sandbox_id", "store_id", "employee_code"),
  CONSTRAINT "employees_sandbox_persona_unique" UNIQUE("sandbox_id", "persona_id"),
  CONSTRAINT "employees_sandbox_store_id_unique" UNIQUE("sandbox_id", "store_id", "id"),
  CONSTRAINT "employees_role" CHECK ("role" IN ('staff', 'manager')),
  CONSTRAINT "employees_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "employees_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict,
  CONSTRAINT "employees_persona_id_demo_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."demo_personas"("id") ON DELETE restrict
);
--> statement-breakpoint
ALTER TABLE "demo_personas" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO "employees" (
  "id", "sandbox_id", "store_id", "persona_id", "employee_code",
  "display_name", "role", "active", "protected"
)
SELECT
  md5('employee:' || persona.id::text)::uuid,
  persona.sandbox_id,
  persona.store_id,
  persona.id,
  CASE persona.role
    WHEN 'staff' THEN 'LEGACY-S-'
    ELSE 'LEGACY-M-'
  END || upper(substr(replace(persona.id::text, '-', ''), 1, 8)),
  persona.display_name,
  persona.role,
  true,
  persona.protected
FROM "demo_personas" persona
WHERE persona.role IN ('staff', 'manager')
  AND persona.store_id IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "demo_personas" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "shifts" (
  "id" uuid PRIMARY KEY,
  "sandbox_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'scheduled' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shifts_sandbox_store_employee_id_unique" UNIQUE("sandbox_id", "store_id", "employee_id", "id"),
  CONSTRAINT "shifts_status" CHECK ("status" IN ('scheduled', 'cancelled')),
  CONSTRAINT "shifts_aligned_duration" CHECK (
    extract(minute from "starts_at") IN (0, 30)
    AND extract(second from "starts_at") = 0
    AND extract(minute from "ends_at") IN (0, 30)
    AND extract(second from "ends_at") = 0
    AND "ends_at" - "starts_at" BETWEEN interval '4 hours' AND interval '12 hours'
  ),
  CONSTRAINT "shifts_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "shifts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict,
  CONSTRAINT "shifts_employee_scope_fk" FOREIGN KEY ("sandbox_id", "store_id", "employee_id") REFERENCES "public"."employees"("sandbox_id", "store_id", "id") ON DELETE restrict,
  CONSTRAINT "shifts_employee_no_overlap" EXCLUDE USING gist (
    "sandbox_id" WITH =,
    "employee_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("status" = 'scheduled')
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
  "id" uuid PRIMARY KEY,
  "sandbox_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "shift_id" uuid NOT NULL,
  "status" text NOT NULL,
  "check_in_outcome" text,
  "check_in_business_at" timestamp with time zone,
  "check_in_recorded_at" timestamp with time zone,
  "check_out_business_at" timestamp with time zone,
  "check_out_recorded_at" timestamp with time zone,
  "absence_business_at" timestamp with time zone,
  "absence_recorded_at" timestamp with time zone,
  CONSTRAINT "attendance_records_shift_unique" UNIQUE("sandbox_id", "shift_id"),
  CONSTRAINT "attendance_records_status" CHECK ("status" IN ('checked-in', 'checked-out', 'absent')),
  CONSTRAINT "attendance_records_check_in_outcome" CHECK ("check_in_outcome" IN ('on-time', 'late')),
  CONSTRAINT "attendance_records_facts" CHECK (
    ("status" = 'checked-in' AND "check_in_outcome" IS NOT NULL AND "check_in_business_at" IS NOT NULL AND "check_in_recorded_at" IS NOT NULL AND "check_out_business_at" IS NULL AND "check_out_recorded_at" IS NULL AND "absence_business_at" IS NULL AND "absence_recorded_at" IS NULL)
    OR ("status" = 'checked-out' AND "check_in_outcome" IS NOT NULL AND "check_in_business_at" IS NOT NULL AND "check_in_recorded_at" IS NOT NULL AND "check_out_business_at" IS NOT NULL AND "check_out_recorded_at" IS NOT NULL AND "absence_business_at" IS NULL AND "absence_recorded_at" IS NULL)
    OR ("status" = 'absent' AND "check_in_outcome" IS NULL AND "check_in_business_at" IS NULL AND "check_in_recorded_at" IS NULL AND "check_out_business_at" IS NULL AND "check_out_recorded_at" IS NULL AND "absence_business_at" IS NOT NULL AND "absence_recorded_at" IS NOT NULL)
  ),
  CONSTRAINT "attendance_records_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "attendance_records_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict,
  CONSTRAINT "attendance_records_shift_scope_fk" FOREIGN KEY ("sandbox_id", "store_id", "employee_id", "shift_id") REFERENCES "public"."shifts"("sandbox_id", "store_id", "employee_id", "id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "attendance_events" (
  "id" uuid PRIMARY KEY,
  "sandbox_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "shift_id" uuid NOT NULL,
  "attendance_record_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "event_data" jsonb NOT NULL,
  "business_occurred_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "attendance_events_type" CHECK ("event_type" IN ('attendance.simulated-check-in', 'attendance.manual-check-out', 'attendance.absence-recorded')),
  CONSTRAINT "attendance_events_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "attendance_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict,
  CONSTRAINT "attendance_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict,
  CONSTRAINT "attendance_events_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE restrict,
  CONSTRAINT "attendance_events_record_id_attendance_records_id_fk" FOREIGN KEY ("attendance_record_id") REFERENCES "public"."attendance_records"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "attendance_command_requests" (
  "sandbox_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "payload_hash" text NOT NULL,
  "result_data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "attendance_command_requests_pk" PRIMARY KEY("sandbox_id", "employee_id", "idempotency_key_hash"),
  CONSTRAINT "attendance_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "attendance_command_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_one_open_per_employee"
  ON "attendance_records" ("sandbox_id", "employee_id")
  WHERE "status" = 'checked-in';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_employee_fixed_scope() RETURNS trigger AS $$
BEGIN
  IF (OLD.store_id, OLD.role) IS DISTINCT FROM (NEW.store_id, NEW.role) THEN
    RAISE EXCEPTION 'Employee store and role are fixed.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "employees_protect_fixed_scope"
  BEFORE UPDATE ON "employees"
  FOR EACH ROW EXECUTE FUNCTION protect_employee_fixed_scope();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_attended_shift_facts() RETURNS trigger AS $$
BEGIN
  IF (OLD.starts_at, OLD.ends_at, OLD.employee_id, OLD.store_id, OLD.status)
      IS DISTINCT FROM
     (NEW.starts_at, NEW.ends_at, NEW.employee_id, NEW.store_id, NEW.status)
     AND EXISTS (
       SELECT 1 FROM attendance_records attendance
        WHERE attendance.sandbox_id = OLD.sandbox_id AND attendance.shift_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'Attended shift facts are immutable.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "shifts_protect_attended_facts"
  BEFORE UPDATE ON "shifts"
  FOR EACH ROW EXECUTE FUNCTION protect_attended_shift_facts();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_attendance_record_facts() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'checked-in'
     AND NEW.status = 'checked-out'
     AND (OLD.id, OLD.sandbox_id, OLD.store_id, OLD.employee_id, OLD.shift_id,
          OLD.check_in_outcome, OLD.check_in_business_at, OLD.check_in_recorded_at,
          OLD.absence_business_at, OLD.absence_recorded_at)
         IS NOT DISTINCT FROM
         (NEW.id, NEW.sandbox_id, NEW.store_id, NEW.employee_id, NEW.shift_id,
          NEW.check_in_outcome, NEW.check_in_business_at, NEW.check_in_recorded_at,
          NEW.absence_business_at, NEW.absence_recorded_at)
     AND OLD.check_out_business_at IS NULL
     AND OLD.check_out_recorded_at IS NULL
     AND NEW.check_out_business_at IS NOT NULL
     AND NEW.check_out_recorded_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Attendance facts are append-only.' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "attendance_records_protect_facts"
  BEFORE UPDATE ON "attendance_records"
  FOR EACH ROW EXECUTE FUNCTION protect_attendance_record_facts();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "employees", "shifts" TO jingshu_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE "attendance_records" TO jingshu_runtime;
GRANT SELECT, INSERT ON TABLE "attendance_events", "attendance_command_requests" TO jingshu_runtime;
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
CREATE POLICY "employees_isolate_by_sandbox" ON "employees"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shifts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "shifts_isolate_by_sandbox" ON "shifts"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "attendance_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "attendance_records_isolate_by_sandbox" ON "attendance_records"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "attendance_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "attendance_events_isolate_by_sandbox" ON "attendance_events"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "attendance_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "attendance_command_requests_isolate_by_sandbox" ON "attendance_command_requests"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '16', "updated_at" = now() WHERE "key" = 'schema_version';
