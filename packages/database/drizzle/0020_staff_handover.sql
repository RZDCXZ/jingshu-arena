CREATE TABLE "handovers" (
  "id" uuid PRIMARY KEY,
  "sandbox_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "shift_id" uuid NOT NULL,
  "submitted_by_employee_id" uuid NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "snapshot" jsonb NOT NULL,
  "submitted_business_at" timestamp with time zone NOT NULL,
  "submitted_recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "handovers_sandbox_shift_unique" UNIQUE("sandbox_id", "shift_id"),
  CONSTRAINT "handovers_sandbox_store_id_unique" UNIQUE("sandbox_id", "store_id", "id"),
  CONSTRAINT "handovers_note_length" CHECK (char_length("note") <= 500),
  CONSTRAINT "handovers_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "handovers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict,
  CONSTRAINT "handovers_submitter_shift_scope_fk" FOREIGN KEY ("sandbox_id", "store_id", "submitted_by_employee_id", "shift_id") REFERENCES "public"."shifts"("sandbox_id", "store_id", "employee_id", "id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "handover_confirmations" (
  "id" uuid PRIMARY KEY,
  "sandbox_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "handover_id" uuid NOT NULL,
  "confirmed_by_employee_id" uuid NOT NULL,
  "business_occurred_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "handover_confirmations_handover_unique" UNIQUE("sandbox_id", "handover_id"),
  CONSTRAINT "handover_confirmations_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "handover_confirmations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict,
  CONSTRAINT "handover_confirmations_handover_scope_fk" FOREIGN KEY ("sandbox_id", "store_id", "handover_id") REFERENCES "public"."handovers"("sandbox_id", "store_id", "id") ON DELETE restrict,
  CONSTRAINT "handover_confirmations_employee_scope_fk" FOREIGN KEY ("sandbox_id", "store_id", "confirmed_by_employee_id") REFERENCES "public"."employees"("sandbox_id", "store_id", "id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "handover_exceptions" (
  "id" uuid PRIMARY KEY,
  "sandbox_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "shift_id" uuid NOT NULL,
  "handover_id" uuid,
  "kind" text NOT NULL,
  "business_occurred_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "handover_exceptions_shift_kind_unique" UNIQUE("sandbox_id", "shift_id", "kind"),
  CONSTRAINT "handover_exceptions_kind" CHECK ("kind" IN ('submission-overdue', 'late-submission', 'confirmation-overdue')),
  CONSTRAINT "handover_exceptions_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "handover_exceptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict,
  CONSTRAINT "handover_exceptions_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE restrict,
  CONSTRAINT "handover_exceptions_handover_id_handovers_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."handovers"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "handover_command_requests" (
  "sandbox_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "command_type" text NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "payload_hash" text NOT NULL,
  "result_data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "handover_command_requests_pk" PRIMARY KEY("sandbox_id", "employee_id", "command_type", "idempotency_key_hash"),
  CONSTRAINT "handover_command_requests_type" CHECK ("command_type" IN ('submit', 'confirm')),
  CONSTRAINT "handover_command_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade,
  CONSTRAINT "handover_command_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_handover_snapshot() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Submitted handover snapshots are immutable.' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "handovers_protect_snapshot"
  BEFORE UPDATE OR DELETE ON "handovers"
  FOR EACH ROW EXECUTE FUNCTION protect_handover_snapshot();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_handover_self_confirmation() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM handovers handover
     WHERE handover.id = NEW.handover_id
       AND handover.submitted_by_employee_id = NEW.confirmed_by_employee_id
  ) THEN
    RAISE EXCEPTION 'A handover requires another same-store employee.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "handover_confirmations_prevent_self"
  BEFORE INSERT ON "handover_confirmations"
  FOR EACH ROW EXECUTE FUNCTION prevent_handover_self_confirmation();
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "handovers", "handover_confirmations", "handover_exceptions", "handover_command_requests" TO jingshu_runtime;
ALTER TABLE "handovers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "handovers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "handovers_isolate_by_sandbox" ON "handovers"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "handover_confirmations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "handover_confirmations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "handover_confirmations_isolate_by_sandbox" ON "handover_confirmations"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "handover_exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "handover_exceptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "handover_exceptions_isolate_by_sandbox" ON "handover_exceptions"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
ALTER TABLE "handover_command_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "handover_command_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "handover_command_requests_isolate_by_sandbox" ON "handover_command_requests"
  USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
  WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '17', "updated_at" = now() WHERE "key" = 'schema_version';
