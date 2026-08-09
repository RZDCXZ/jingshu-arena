CREATE TABLE "sandbox_creation_requests" (
	"creation_key_hash" text PRIMARY KEY NOT NULL,
	"payload_hash" text NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"selected_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_creation_requests_public_role" CHECK ("selected_role" IN ('customer', 'staff', 'manager', 'hq')),
	CONSTRAINT "sandbox_creation_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY DEFERRED
);
