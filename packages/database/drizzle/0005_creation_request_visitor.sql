ALTER TABLE "sandbox_creation_requests" ADD COLUMN "visitor_key_hash" text;
--> statement-breakpoint
UPDATE "sandbox_creation_requests"
SET "visitor_key_hash" = "creation_key_hash"
WHERE "visitor_key_hash" IS NULL;
--> statement-breakpoint
ALTER TABLE "sandbox_creation_requests" ALTER COLUMN "visitor_key_hash" SET NOT NULL;
