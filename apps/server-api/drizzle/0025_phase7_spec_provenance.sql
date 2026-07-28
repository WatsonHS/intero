ALTER TABLE project_work_items
  DROP CONSTRAINT project_work_items_priority_check,
  ADD CONSTRAINT project_work_items_priority_check
    CHECK (priority IN ('unset','P0','P1','P2','P3')),
  ADD COLUMN source_spec_revision_id uuid REFERENCES spec_revisions(id),
  ADD COLUMN source_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN automation_policy_version text;

ALTER TABLE spec_revisions
  ADD COLUMN confirmed_at timestamptz;

UPDATE spec_revisions revision
SET confirmed_at = COALESCE(revision.confirmed_at, spec.updated_at)
FROM specs spec
WHERE spec.confirmed_revision_id = revision.id;

ALTER TABLE project_features
  ADD COLUMN spec_id uuid REFERENCES specs(id),
  ADD COLUMN source_spec_revision_id uuid REFERENCES spec_revisions(id),
  ADD COLUMN source_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN automation_policy_version text,
  ADD COLUMN revoked_at timestamptz;

ALTER TABLE project_work_relations
  ADD COLUMN spec_id uuid REFERENCES specs(id),
  ADD COLUMN source_spec_revision_id uuid REFERENCES spec_revisions(id),
  ADD COLUMN source_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN automation_policy_version text,
  ADD COLUMN idempotency_key text,
  ADD COLUMN revoked_at timestamptz;

ALTER TABLE project_work_comments
  ADD COLUMN spec_id uuid REFERENCES specs(id),
  ADD COLUMN source_spec_revision_id uuid REFERENCES spec_revisions(id),
  ADD COLUMN source_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN automation_policy_version text,
  ADD COLUMN idempotency_key text;

CREATE TABLE project_feature_history (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  feature_id uuid NOT NULL REFERENCES project_features(id) ON DELETE CASCADE,
  idempotency_key text,
  action text NOT NULL,
  snapshot jsonb NOT NULL,
  actor jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reverted_entry_id uuid REFERENCES project_feature_history(id),
  UNIQUE (project_id, idempotency_key)
);

CREATE INDEX project_feature_history_feature_idx
  ON project_feature_history(feature_id, occurred_at);
CREATE INDEX project_features_source_spec_idx
  ON project_features(spec_id, source_spec_revision_id);
CREATE INDEX project_work_items_source_spec_idx
  ON project_work_items(spec_id, source_spec_revision_id);
CREATE INDEX project_work_relations_source_spec_idx
  ON project_work_relations(spec_id, source_spec_revision_id);
CREATE INDEX project_work_comments_source_spec_idx
  ON project_work_comments(spec_id, source_spec_revision_id);
CREATE UNIQUE INDEX project_work_relations_idempotency_idx
  ON project_work_relations(organization_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX project_work_comments_idempotency_idx
  ON project_work_comments(organization_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE project_feature_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_feature_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_feature_history
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON project_feature_history TO intero_app;
  END IF;
END $$;
