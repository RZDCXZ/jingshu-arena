CREATE TABLE "sandbox_lifecycle_tasks" (
	"sandbox_id" uuid PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"cleanup_reason" text,
	"cleanup_phase" text,
	"cleanup_started_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_lifecycle_tasks_state" CHECK ("state" IN ('active', 'pending', 'retry')),
	CONSTRAINT "sandbox_lifecycle_tasks_cleanup_reason" CHECK ("cleanup_reason" IS NULL OR "cleanup_reason" IN ('expired', 'reset')),
	CONSTRAINT "sandbox_lifecycle_tasks_cleanup_phase" CHECK ("cleanup_phase" IS NULL OR "cleanup_phase" IN ('blobs', 'business')),
	CONSTRAINT "sandbox_lifecycle_tasks_cleanup_shape" CHECK (
		("state" = 'active' AND "cleanup_reason" IS NULL AND "cleanup_phase" IS NULL)
		OR ("state" IN ('pending', 'retry') AND "cleanup_reason" IS NOT NULL AND "cleanup_phase" IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE INDEX "sandbox_lifecycle_tasks_due_idx"
ON "sandbox_lifecycle_tasks" USING btree ("state", "available_at");
--> statement-breakpoint
CREATE INDEX "sandbox_lifecycle_tasks_active_expiry_idx"
ON "sandbox_lifecycle_tasks" USING btree ("expires_at")
WHERE "state" = 'active';
--> statement-breakpoint
CREATE TABLE "sandbox_request_rate_limits" (
	"operation" text NOT NULL,
	"subject_kind" text NOT NULL,
	"window_kind" text NOT NULL,
	"subject_hash" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_request_rate_limits_pk" PRIMARY KEY ("operation", "subject_kind", "window_kind", "subject_hash", "window_started_at"),
	CONSTRAINT "sandbox_request_rate_limits_operation" CHECK ("operation" IN ('create', 'reset')),
	CONSTRAINT "sandbox_request_rate_limits_subject_kind" CHECK ("subject_kind" IN ('visitor', 'ip')),
	CONSTRAINT "sandbox_request_rate_limits_window_kind" CHECK ("window_kind" IN ('hour', 'day')),
	CONSTRAINT "sandbox_request_rate_limits_positive_count" CHECK ("request_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "sandbox_deletion_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sandbox_deletion_receipts_reason" CHECK ("reason" IN ('expired', 'reset')),
	CONSTRAINT "sandbox_deletion_receipts_non_negative_attempts" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
INSERT INTO "sandbox_lifecycle_tasks" (
	"sandbox_id", "expires_at", "state", "cleanup_reason", "cleanup_phase",
	"attempts", "available_at", "created_at", "updated_at"
)
SELECT
	"id",
	"expires_at",
	CASE WHEN "invalidated_at" IS NULL THEN 'active' ELSE 'pending' END,
	CASE WHEN "invalidated_at" IS NULL THEN NULL ELSE 'reset' END,
	CASE WHEN "invalidated_at" IS NULL THEN NULL ELSE 'blobs' END,
	0,
	COALESCE("invalidated_at", "created_at"),
	"created_at",
	COALESCE("invalidated_at", "created_at")
FROM "sandboxes"
ON CONFLICT ("sandbox_id") DO NOTHING;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE
	"sandbox_lifecycle_tasks", "sandbox_request_rate_limits"
TO jingshu_runtime;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_public_employee() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.sandbox_cleanup', true) = 'true' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
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
CREATE OR REPLACE FUNCTION protect_attendance_correction() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.sandbox_cleanup', true) = 'true' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM sandboxes WHERE id = OLD.sandbox_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Attendance corrections are append-only.' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_handover_snapshot() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.sandbox_cleanup', true) = 'true' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'Submitted handover snapshots are immutable.' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
UPDATE "jingshu_schema_metadata" SET "value" = '23', "updated_at" = now() WHERE "key" = 'schema_version';
