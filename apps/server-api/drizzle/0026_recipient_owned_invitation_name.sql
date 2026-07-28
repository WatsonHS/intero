UPDATE "pilot_team_invitations"
SET "data" = "data" - 'displayName';
--> statement-breakpoint
ALTER TABLE "pilot_team_invitations" DROP COLUMN "display_name";
