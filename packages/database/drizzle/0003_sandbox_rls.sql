DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jingshu_runtime') THEN
		CREATE ROLE jingshu_runtime NOLOGIN;
	END IF;
END
$$;
--> statement-breakpoint
GRANT jingshu_runtime TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO jingshu_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
	"sandboxes",
	"operators",
	"stores",
	"demo_personas",
	"sandbox_creation_requests"
TO jingshu_runtime;
--> statement-breakpoint
ALTER TABLE "sandboxes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sandboxes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "sandboxes_isolate_by_sandbox" ON "sandboxes"
	USING ("id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "operators" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "operators" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "operators_isolate_by_sandbox" ON "operators"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "stores_isolate_by_sandbox" ON "stores"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "demo_personas" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "demo_personas" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "demo_personas_isolate_by_sandbox" ON "demo_personas"
	USING ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid)
	WITH CHECK ("sandbox_id" = nullif(current_setting('app.sandbox_id', true), '')::uuid);
