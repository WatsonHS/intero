CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE workstreams ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_work_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE spec_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE spec_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE workstreams FORCE ROW LEVEL SECURITY;
ALTER TABLE claims FORCE ROW LEVEL SECURITY;
ALTER TABLE public_work_projections FORCE ROW LEVEL SECURITY;
ALTER TABLE threads FORCE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
ALTER TABLE capability_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE specs FORCE ROW LEVEL SECURITY;
ALTER TABLE spec_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE spec_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE activity_events FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE FUNCTION intero_current_organization_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('intero.organization_id', true), '')::uuid
$$;

CREATE POLICY organization_tenant ON organizations
  USING (id = intero_current_organization_id())
  WITH CHECK (id = intero_current_organization_id());

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'memberships', 'projects', 'workstreams', 'claims',
    'public_work_projections', 'threads', 'messages', 'capability_grants',
    'specs', 'spec_revisions', 'spec_reviews', 'decisions',
    'activity_events', 'outbox', 'idempotency_keys'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = intero_current_organization_id()) WITH CHECK (organization_id = intero_current_organization_id())',
      table_name
    );
  END LOOP;
END
$$;

CREATE INDEX workstreams_title_trgm_idx
  ON workstreams USING gin (title gin_trgm_ops);
CREATE INDEX decisions_search_idx
  ON decisions USING gin (to_tsvector('simple', title || ' ' || outcome));
