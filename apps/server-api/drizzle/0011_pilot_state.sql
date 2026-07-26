CREATE TABLE "pilot_state" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pilot_state" ADD CONSTRAINT "pilot_state_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE pilot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_state FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pilot_state
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());
