CREATE OR REPLACE FUNCTION intero_notify_workspace_changed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_project_id text;
BEGIN
  event_project_id := COALESCE(
    NEW.payload ->> 'projectId',
    NEW.payload -> 'payload' ->> 'projectId',
    substring(NEW.topic FROM '^project\.([0-9a-fA-F-]{36})\.')
  );

  PERFORM pg_notify(
    'intero_workspace_events',
    jsonb_strip_nulls(
      jsonb_build_object(
        'organizationId', NEW.organization_id,
        'reason', 'workspace_change',
        'eventType', COALESCE(NEW.payload ->> 'eventType', NEW.topic),
        'aggregateType', NEW.payload ->> 'aggregateType',
        'aggregateId', NEW.payload ->> 'aggregateId',
        'projectId', event_project_id,
        'occurredAt', clock_timestamp()
      )
    )::text
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_workspace_changed_notify
AFTER INSERT ON outbox
FOR EACH ROW
EXECUTE FUNCTION intero_notify_workspace_changed();

CREATE TABLE realtime_rate_limits (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, key_hash)
);

CREATE INDEX realtime_rate_limits_updated_idx
  ON realtime_rate_limits (updated_at);

ALTER TABLE realtime_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime_rate_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON realtime_rate_limits
  USING (organization_id = current_setting('intero.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('intero.organization_id', true)::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON realtime_rate_limits TO intero_app;
  END IF;
END
$$;
