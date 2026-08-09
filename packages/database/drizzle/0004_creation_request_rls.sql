ALTER TABLE "sandbox_creation_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sandbox_creation_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "sandbox_creation_requests_isolate_by_creation_key" ON "sandbox_creation_requests"
	USING ("creation_key_hash" = nullif(current_setting('app.creation_key_hash', true), ''))
	WITH CHECK ("creation_key_hash" = nullif(current_setting('app.creation_key_hash', true), ''));
