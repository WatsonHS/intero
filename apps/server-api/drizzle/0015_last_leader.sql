CREATE TABLE "pilot_team_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pilot_team_memberships" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "pilot_team_memberships" ADD COLUMN "joined_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pilot_team_memberships" ADD CONSTRAINT "pilot_team_memberships_role_check" CHECK ("role" IN ('member', 'leader'));--> statement-breakpoint
ALTER TABLE "pilot_team_invitations" ADD CONSTRAINT "pilot_team_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_team_invitations" ADD CONSTRAINT "pilot_team_invitations_team_id_pilot_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."pilot_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_team_invitations" ADD CONSTRAINT "pilot_team_invitations_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_team_invitations" ADD CONSTRAINT "pilot_team_invitations_accepted_by_principals_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_team_invitations_token_hash_idx" ON "pilot_team_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pilot_team_invitations_team_status_idx" ON "pilot_team_invitations" USING btree ("organization_id","team_id","created_at");--> statement-breakpoint
CREATE INDEX "pilot_team_invitations_email_idx" ON "pilot_team_invitations" USING btree ("organization_id","email");--> statement-breakpoint
ALTER TABLE "pilot_team_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pilot_team_invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pilot_team_invitations"
  USING ("organization_id" = intero_current_organization_id())
  WITH CHECK ("organization_id" = intero_current_organization_id());
