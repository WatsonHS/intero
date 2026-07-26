ALTER TABLE action_inbox
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id),
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

CREATE TABLE IF NOT EXISTS notification_preferences (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  principal_id uuid NOT NULL REFERENCES principals(id),
  muted_kinds jsonb NOT NULL DEFAULT '[]'::jsonb,
  mute_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, principal_id)
);

CREATE TABLE IF NOT EXISTS auth_activation_attempts (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  key_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, key_hash)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_preferences
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());
ALTER TABLE auth_activation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_activation_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth_activation_attempts
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON notification_preferences TO intero_app;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON auth_activation_attempts TO intero_app;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS action_inbox_principal_attention_idx
  ON action_inbox(principal_id, dismissed_at, resolved_at, created_at DESC);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS project_work_items_search_title_idx
  ON project_work_items USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS project_work_items_search_description_idx
  ON project_work_items USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS specs_search_title_idx
  ON specs USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS spec_revisions_search_markdown_idx
  ON spec_revisions USING gin (markdown gin_trgm_ops);
CREATE INDEX IF NOT EXISTS project_work_comments_search_body_idx
  ON project_work_comments USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS project_spec_comments_search_body_idx
  ON project_spec_comments USING gin (body gin_trgm_ops);
