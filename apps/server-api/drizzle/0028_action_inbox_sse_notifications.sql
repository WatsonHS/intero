CREATE OR REPLACE FUNCTION intero_notify_action_inbox_changed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_organization_id uuid;
  event_principal_id uuid;
  event_reason text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    event_organization_id := OLD.organization_id;
    event_principal_id := OLD.principal_id;
  ELSE
    event_organization_id := NEW.organization_id;
    event_principal_id := NEW.principal_id;
  END IF;

  event_reason := CASE TG_TABLE_NAME
    WHEN 'action_inbox' THEN 'action_inbox'
    WHEN 'notification_preferences' THEN 'notification_preferences'
    WHEN 'project_automation_summary_jobs' THEN 'automation_summary'
  END;

  PERFORM pg_notify(
    'intero_action_inbox_events',
    jsonb_build_object(
      'organizationId', event_organization_id,
      'principalId', event_principal_id,
      'reason', event_reason,
      'occurredAt', clock_timestamp()
    )::text
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER action_inbox_changed_notify
AFTER INSERT OR UPDATE OR DELETE ON action_inbox
FOR EACH ROW
EXECUTE FUNCTION intero_notify_action_inbox_changed();

CREATE TRIGGER notification_preferences_changed_notify
AFTER INSERT OR UPDATE OR DELETE ON notification_preferences
FOR EACH ROW
EXECUTE FUNCTION intero_notify_action_inbox_changed();

CREATE TRIGGER automation_summary_completed_notify
AFTER UPDATE OF status, summary, completed_at
ON project_automation_summary_jobs
FOR EACH ROW
WHEN (
  NEW.status = 'completed'
  AND (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.summary IS DISTINCT FROM NEW.summary
    OR OLD.completed_at IS DISTINCT FROM NEW.completed_at
  )
)
EXECUTE FUNCTION intero_notify_action_inbox_changed();
