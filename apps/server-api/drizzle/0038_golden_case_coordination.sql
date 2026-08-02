ALTER TABLE "pilot_coordination_threads"
  ADD COLUMN "team_id" uuid,
  ADD COLUMN "scope_kind" text,
  ADD COLUMN "source_message_id" uuid REFERENCES "messages"("id"),
  ADD COLUMN "intero_principal_id" uuid REFERENCES "principals"("id"),
  ADD COLUMN "brief" jsonb,
  ADD COLUMN "decision_id" uuid REFERENCES "decisions"("id");

ALTER TABLE "pilot_coordination_threads"
  ADD CONSTRAINT "pilot_coordination_scope_kind_check" CHECK (
    "scope_kind" IS NULL OR
    "scope_kind" IN ('single_project', 'cross_project', 'team')
  );

CREATE TABLE "pilot_coordination_projects" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "thread_id" uuid NOT NULL REFERENCES "pilot_coordination_threads"("id")
    ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("thread_id", "project_id")
);

INSERT INTO "pilot_coordination_projects"
  ("organization_id", "thread_id", "project_id")
SELECT "organization_id", "id", "project_id"
FROM "pilot_coordination_threads"
ON CONFLICT ("thread_id", "project_id") DO NOTHING;

CREATE INDEX "pilot_coordination_projects_project_idx"
  ON "pilot_coordination_projects" ("organization_id", "project_id");

CREATE TABLE "pilot_intero_requests" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "team_id" uuid NOT NULL REFERENCES "pilot_teams"("id"),
  "source_room_thread_id" uuid NOT NULL REFERENCES "threads"("id"),
  "source_message_id" uuid NOT NULL REFERENCES "messages"("id"),
  "requested_by_principal_id" uuid NOT NULL REFERENCES "principals"("id"),
  "intero_principal_id" uuid NOT NULL REFERENCES "principals"("id"),
  "status" text NOT NULL CHECK (
    "status" IN (
      'pending', 'needs_scope', 'coordinating', 'answered', 'failed'
    )
  ),
  "scope_revision" integer NOT NULL DEFAULT 1 CHECK ("scope_revision" > 0),
  "response_message_id" uuid REFERENCES "messages"("id"),
  "coordination_thread_id" uuid REFERENCES "pilot_coordination_threads"("id"),
  "last_error_code" text,
  "data" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "pilot_intero_requests_source_message_idx"
  ON "pilot_intero_requests" ("organization_id", "source_message_id");
CREATE INDEX "pilot_intero_requests_pending_idx"
  ON "pilot_intero_requests" ("organization_id", "status", "updated_at");

ALTER TABLE "pilot_coordination_projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pilot_coordination_projects" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pilot_coordination_projects"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

ALTER TABLE "pilot_intero_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pilot_intero_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pilot_intero_requests"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "pilot_coordination_projects" TO intero_app;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "pilot_intero_requests" TO intero_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "pilot_coordination_projects" TO intero_worker;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "pilot_intero_requests" TO intero_worker;
  END IF;
END
$$;
