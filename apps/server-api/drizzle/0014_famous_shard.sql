CREATE TABLE "object_store_objects" (
	"object_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"encrypted" boolean NOT NULL,
	"encryption_mode" text NOT NULL,
	"state" text NOT NULL,
	"failure_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	"scanned_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_store_objects_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "object_store_objects_purpose_check" CHECK ("purpose" IN ('artifact', 'authorized_raw')),
	CONSTRAINT "object_store_objects_size_check" CHECK ("byte_size" > 0 AND "byte_size" <= 26214400),
	CONSTRAINT "object_store_objects_checksum_check" CHECK ("checksum_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "object_store_objects_encryption_check" CHECK ("encryption_mode" IN ('AES256', 'aws:kms')),
	CONSTRAINT "object_store_objects_state_check" CHECK ("state" IN ('pending_upload', 'uploaded', 'available', 'quarantined', 'failed', 'deleted')),
	CONSTRAINT "object_store_objects_raw_encryption_check" CHECK ("purpose" <> 'authorized_raw' OR "encrypted")
);
--> statement-breakpoint
ALTER TABLE "object_store_objects" ADD CONSTRAINT "object_store_objects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "object_store_objects_org_state_idx" ON "object_store_objects" USING btree ("organization_id","state","updated_at");--> statement-breakpoint
CREATE INDEX "object_store_objects_cleanup_idx" ON "object_store_objects" USING btree ("expires_at") WHERE "object_store_objects"."state" IN ('pending_upload', 'quarantined', 'failed');--> statement-breakpoint
ALTER TABLE "object_store_objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "object_store_objects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "object_store_objects"
  USING ("organization_id" = intero_current_organization_id())
  WITH CHECK ("organization_id" = intero_current_organization_id());
