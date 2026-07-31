ALTER TABLE "messages"
  ADD COLUMN "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "pilot_coordination_threads"
  ADD COLUMN "boundary_key" text,
  ADD COLUMN "dedupe_key" text,
  ADD COLUMN "conversation_thread_id" uuid REFERENCES "threads"("id"),
  ADD COLUMN "source_room_thread_id" uuid REFERENCES "threads"("id"),
  ADD COLUMN "summary_message_id" uuid REFERENCES "messages"("id");

ALTER TABLE "project_automation_signals"
  DROP CONSTRAINT "project_automation_signals_kind_check";
ALTER TABLE "project_automation_signals"
  ADD CONSTRAINT "project_automation_signals_kind_check" CHECK (
    "kind" IN (
      'blocker',
      'dependency_change',
      'spec_review_stale',
      'coordination_unresolved',
      'project_work_risk',
      'work_state_conflict'
    )
  );

CREATE UNIQUE INDEX "pilot_coordination_dedupe_unique_idx"
  ON "pilot_coordination_threads" ("organization_id", "project_id", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;

CREATE TABLE "pilot_shared_boundary_claims" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "work_state_id" uuid NOT NULL REFERENCES "pilot_work_states"("id"),
  "owner_id" uuid NOT NULL REFERENCES "principals"("id"),
  "binding_id" uuid NOT NULL REFERENCES "pilot_agent_bindings"("id"),
  "checkpoint_client_event_id" text NOT NULL,
  "boundary_key" text NOT NULL,
  "revision" integer NOT NULL CHECK ("revision" > 0),
  "observed_at" timestamptz NOT NULL,
  "superseded_at" timestamptz,
  "withdrawn_at" timestamptz,
  "data" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "pilot_shared_boundary_claim_revision_idx"
  ON "pilot_shared_boundary_claims" ("work_state_id", "boundary_key", "revision");
CREATE UNIQUE INDEX "pilot_shared_boundary_claim_event_idx"
  ON "pilot_shared_boundary_claims"
    ("organization_id", "checkpoint_client_event_id", "boundary_key");
CREATE INDEX "pilot_shared_boundary_claim_match_idx"
  ON "pilot_shared_boundary_claims"
    ("project_id", "boundary_key", "observed_at");

CREATE TABLE "pilot_coordination_sources" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "thread_id" uuid NOT NULL REFERENCES "pilot_coordination_threads"("id")
    ON DELETE CASCADE,
  "work_state_id" uuid NOT NULL REFERENCES "pilot_work_states"("id"),
  "claim_id" uuid NOT NULL REFERENCES "pilot_shared_boundary_claims"("id"),
  "owner_id" uuid NOT NULL REFERENCES "principals"("id"),
  "claim_revision" integer NOT NULL CHECK ("claim_revision" > 0),
  "observed_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("thread_id", "claim_id")
);

CREATE INDEX "pilot_coordination_sources_work_state_idx"
  ON "pilot_coordination_sources" ("work_state_id");

CREATE TABLE "pilot_coordination_relevance" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "thread_id" uuid NOT NULL REFERENCES "pilot_coordination_threads"("id")
    ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "source_room_thread_id" uuid REFERENCES "threads"("id"),
  "principal_id" uuid NOT NULL REFERENCES "principals"("id"),
  "reason" text NOT NULL,
  "dismissed_at" timestamptz,
  "muted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("thread_id", "principal_id")
);

CREATE INDEX "pilot_coordination_relevance_principal_idx"
  ON "pilot_coordination_relevance" ("project_id", "principal_id");

ALTER TABLE "pilot_shared_boundary_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pilot_shared_boundary_claims" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pilot_shared_boundary_claims"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

ALTER TABLE "pilot_coordination_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pilot_coordination_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pilot_coordination_sources"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

ALTER TABLE "pilot_coordination_relevance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pilot_coordination_relevance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pilot_coordination_relevance"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "pilot_shared_boundary_claims" TO intero_app;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "pilot_coordination_sources" TO intero_app;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "pilot_coordination_relevance" TO intero_app;
  END IF;
END
$$;
