CREATE TABLE project_automation_policies (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  enabled boolean NOT NULL DEFAULT false,
  enabled_signals text[] NOT NULL DEFAULT ARRAY[
    'blocker',
    'dependency_change',
    'spec_review_stale',
    'coordination_unresolved',
    'project_work_risk'
  ]::text[],
  stale_spec_review_hours integer NOT NULL DEFAULT 48
    CHECK (stale_spec_review_hours BETWEEN 1 AND 720),
  unresolved_coordination_hours integer NOT NULL DEFAULT 24
    CHECK (unresolved_coordination_hours BETWEEN 1 AND 720),
  quiet_until timestamptz,
  updated_by uuid REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_automation_signals (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK (
    kind IN (
      'blocker',
      'dependency_change',
      'spec_review_stale',
      'coordination_unresolved',
      'project_work_risk'
    )
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'processing',
      'opened',
      'confirmed',
      'reverted',
      'dismissed',
      'failed'
    )
  ),
  fingerprint text NOT NULL,
  source_ref text NOT NULL,
  safe_context text NOT NULL,
  candidate_next_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  participant_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  target_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  coordination_thread_id uuid,
  detected_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  UNIQUE (organization_id, project_id, fingerprint)
);

CREATE TABLE project_automation_audit (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  signal_id uuid NOT NULL REFERENCES project_automation_signals(id),
  action text NOT NULL CHECK (
    action IN (
      'detected',
      'coordination_opened',
      'confirmed',
      'reverted',
      'dismissed',
      'quieted'
    )
  ),
  actor_id uuid REFERENCES principals(id),
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pilot_coordination_threads
  ALTER COLUMN work_state_id DROP NOT NULL,
  ALTER COLUMN source_binding_id DROP NOT NULL,
  ADD COLUMN automation_signal_id uuid
    REFERENCES project_automation_signals(id);

ALTER TABLE project_automation_signals
  ADD CONSTRAINT project_automation_signals_coordination_thread_fk
  FOREIGN KEY (coordination_thread_id)
  REFERENCES pilot_coordination_threads(id);

CREATE UNIQUE INDEX project_automation_coordination_signal_idx
  ON pilot_coordination_threads(automation_signal_id)
  WHERE automation_signal_id IS NOT NULL;
CREATE INDEX project_automation_signal_queue_idx
  ON project_automation_signals(status, detected_at);
CREATE INDEX project_automation_signal_project_idx
  ON project_automation_signals(project_id, updated_at DESC);
CREATE INDEX project_automation_audit_signal_idx
  ON project_automation_audit(signal_id, created_at);

ALTER TABLE project_automation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_automation_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_automation_policies
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

ALTER TABLE project_automation_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_automation_signals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_automation_signals
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

ALTER TABLE project_automation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_automation_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_automation_audit
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON project_automation_policies,
         project_automation_signals,
         project_automation_audit
      TO intero_app;
  END IF;
END $$;
