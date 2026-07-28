CREATE TABLE project_automation_summary_jobs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  principal_id uuid NOT NULL REFERENCES principals(id),
  source_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  summary jsonb,
  freshness_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX project_automation_summary_active_key_idx
  ON project_automation_summary_jobs(
    organization_id,
    principal_id,
    source_fingerprint
  )
  WHERE status IN ('pending','processing','completed');

CREATE INDEX project_automation_summary_principal_idx
  ON project_automation_summary_jobs(
    organization_id,
    principal_id,
    completed_at DESC
  );

CREATE INDEX project_automation_summary_pending_idx
  ON project_automation_summary_jobs(
    organization_id,
    status,
    created_at
  )
  WHERE status IN ('pending','processing');

ALTER TABLE project_automation_summary_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_automation_summary_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON project_automation_summary_jobs
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON project_automation_summary_jobs TO intero_app;
  END IF;
END
$$;
