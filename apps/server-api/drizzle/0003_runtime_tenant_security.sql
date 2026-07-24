DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'action_envelopes', 'action_inbox', 'canonical_events', 'thread_participants'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = intero_current_organization_id()) WITH CHECK (organization_id = intero_current_organization_id())',
      table_name
    );
  END LOOP;
END
$$;
