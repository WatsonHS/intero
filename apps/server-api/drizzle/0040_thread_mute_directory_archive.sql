ALTER TABLE "threads"
  ADD COLUMN "visibility" text NOT NULL DEFAULT 'private',
  ADD COLUMN "created_by" uuid REFERENCES "principals"("id"),
  ADD COLUMN "archived_at" timestamptz,
  ADD COLUMN "archived_by" uuid REFERENCES "principals"("id");

ALTER TABLE "threads"
  ADD CONSTRAINT "threads_visibility_check" CHECK (
    "visibility" IN ('private', 'team')
  );

ALTER TABLE "threads"
  ADD CONSTRAINT "threads_team_visibility_kind_check" CHECK (
    "visibility" = 'private' OR "kind" = 'room'
  );

ALTER TABLE "thread_participants"
  ADD COLUMN "archived_at" timestamptz;

CREATE INDEX "threads_team_visibility_idx"
  ON "threads" ("organization_id", "team_id")
  WHERE "visibility" = 'team' AND "kind" = 'room';

CREATE TABLE "thread_notification_preferences" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "thread_id" uuid NOT NULL REFERENCES "threads"("id") ON DELETE CASCADE,
  "principal_id" uuid NOT NULL REFERENCES "principals"("id"),
  "muted_until" timestamptz,
  "mute_including_mentions" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("thread_id", "principal_id")
);

CREATE INDEX "thread_notification_preferences_principal_idx"
  ON "thread_notification_preferences" ("organization_id", "principal_id");

ALTER TABLE "thread_notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thread_notification_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "thread_notification_preferences"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "thread_notification_preferences" TO intero_app;
  END IF;
END $$;
