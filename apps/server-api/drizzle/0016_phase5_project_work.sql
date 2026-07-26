ALTER TABLE projects ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';
ALTER TABLE specs ADD COLUMN IF NOT EXISTS review_requested_at timestamptz;
ALTER TABLE specs ADD COLUMN IF NOT EXISTS confirmed_revision_id uuid REFERENCES spec_revisions(id);

CREATE TABLE project_epics (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_program_increments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  number integer NOT NULL CHECK (number > 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  timezone text NOT NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);
CREATE TABLE project_sprints (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  pi_id uuid NOT NULL REFERENCES project_program_increments(id),
  number integer NOT NULL CHECK (number > 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  closed_at timestamptz,
  UNIQUE (pi_id, number)
);
CREATE TABLE project_features (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  epic_id uuid REFERENCES project_epics(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  stage text NOT NULL CHECK (stage IN ('planned','in_development','released')),
  owner_id uuid REFERENCES principals(id),
  pi_id uuid REFERENCES project_program_increments(id),
  sprint_id uuid REFERENCES project_sprints(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_work_items (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  feature_id uuid REFERENCES project_features(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','ready_for_test','done')),
  owner_id uuid REFERENCES principals(id),
  spec_id uuid REFERENCES specs(id),
  priority text NOT NULL DEFAULT 'P2' CHECK (priority IN ('P0','P1','P2','P3')),
  points numeric CHECK (points >= 0),
  pi_id uuid REFERENCES project_program_increments(id),
  sprint_id uuid REFERENCES project_sprints(id),
  source_sprint_id uuid REFERENCES project_sprints(id),
  carryover boolean NOT NULL DEFAULT false,
  completion_evidence text,
  completed_by jsonb,
  completed_at timestamptz,
  revoked_at timestamptz,
  coordination_thread_ids jsonb NOT NULL DEFAULT '[]',
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_work_relations (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  source_id uuid NOT NULL REFERENCES project_work_items(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES project_work_items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('blocks','blocked_by','related','duplicate','duplicated_by')),
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, target_id, kind),
  CHECK (source_id <> target_id)
);
CREATE TABLE project_work_code_refs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  work_item_id uuid NOT NULL REFERENCES project_work_items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pull_request','commit','branch')),
  label text NOT NULL,
  url text,
  repository text,
  value text NOT NULL,
  reported_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_work_comments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  work_item_id uuid NOT NULL REFERENCES project_work_items(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES project_work_comments(id),
  body text NOT NULL,
  author jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE TABLE project_work_history (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  work_item_id uuid NOT NULL REFERENCES project_work_items(id) ON DELETE CASCADE,
  idempotency_key text,
  action text NOT NULL,
  snapshot jsonb NOT NULL,
  actor jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reverted_entry_id uuid REFERENCES project_work_history(id),
  UNIQUE (project_id, idempotency_key)
);
CREATE TABLE project_spec_review_policies (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  required_confirmations integer NOT NULL DEFAULT 1 CHECK (required_confirmations BETWEEN 1 AND 3),
  other_member_agents_count boolean NOT NULL DEFAULT true,
  author_self_confirmation boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_spec_reviewer_nominations (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  spec_id uuid NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES spec_revisions(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (revision_id, reviewer_id)
);
CREATE TABLE project_spec_comment_threads (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  spec_id uuid NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES spec_revisions(id) ON DELETE CASCADE,
  line_start integer NOT NULL CHECK (line_start > 0),
  line_end integer NOT NULL CHECK (line_end >= line_start),
  selection text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE TABLE project_spec_comments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  thread_id uuid NOT NULL REFERENCES project_spec_comment_threads(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES project_spec_comments(id),
  author_id uuid NOT NULL REFERENCES principals(id),
  author_kind text NOT NULL CHECK (author_kind IN ('human','agent')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_spec_confirmations (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  spec_id uuid NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES spec_revisions(id) ON DELETE CASCADE,
  confirmer_id uuid NOT NULL REFERENCES principals(id),
  confirmer_kind text NOT NULL CHECK (confirmer_kind IN ('human','agent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (revision_id, confirmer_id)
);

ALTER TABLE spec_revisions ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX project_work_items_board_idx ON project_work_items(project_id, status, updated_at);
CREATE INDEX project_work_items_owner_idx ON project_work_items(project_id, owner_id, status);
CREATE INDEX project_work_comments_item_idx ON project_work_comments(work_item_id, created_at);
CREATE INDEX project_spec_threads_revision_idx ON project_spec_comment_threads(revision_id, created_at);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'project_epics','project_program_increments','project_sprints','project_features',
    'project_work_items','project_work_relations','project_work_code_refs',
    'project_work_comments','project_work_history','project_spec_review_policies',
    'project_spec_reviewer_nominations','project_spec_comment_threads',
    'project_spec_comments','project_spec_confirmations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = intero_current_organization_id()) WITH CHECK (organization_id = intero_current_organization_id())',
      table_name
    );
  END LOOP;
END $$;
