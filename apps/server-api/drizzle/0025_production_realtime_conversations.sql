ALTER TABLE "threads"
  ADD COLUMN "access_version" integer NOT NULL DEFAULT 1,
  ADD COLUMN "latest_message_at" timestamp with time zone;

ALTER TABLE "thread_participants"
  ADD COLUMN "visible_from_sequence" integer NOT NULL DEFAULT 1,
  ADD COLUMN "revoked_at" timestamp with time zone;

ALTER TABLE "messages"
  ADD COLUMN "client_message_id" uuid;

UPDATE "messages"
SET "client_message_id" = "id"
WHERE "client_message_id" IS NULL;

ALTER TABLE "messages"
  ALTER COLUMN "client_message_id" SET NOT NULL;

-- Collapse the former Pilot-only direct-message store into canonical
-- conversations. A system access event is inserted at the old Stand-in
-- boundary and later message sequences are shifted by one to preserve order.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pilot_dm_threads d
    JOIN threads t ON t.id = d.id
    WHERE t.organization_id <> d.organization_id
       OR t.kind <> 'human_direct'
       OR t.team_id IS DISTINCT FROM d.team_id
  ) THEN
    RAISE EXCEPTION
      'Pilot direct-message migration found an incompatible canonical Thread ID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pilot_dm_messages legacy
    JOIN messages canonical ON canonical.id = legacy.id
    WHERE canonical.organization_id <> legacy.organization_id
       OR canonical.thread_id <> legacy.thread_id
       OR canonical.sender_id <> legacy.sender_id
  ) THEN
    RAISE EXCEPTION
      'Pilot direct-message migration found an incompatible canonical Message ID';
  END IF;
END
$$;

INSERT INTO "threads" (
  "id", "organization_id", "kind", "title", "access_mode",
  "access_changed_at_sequence", "prior_history_granted", "sequence",
  "access_version", "latest_message_at", "team_id", "created_at", "updated_at"
)
SELECT
  d.id,
  d.organization_id,
  'human_direct',
  'Direct message',
  'agent_readable',
  CASE
    WHEN d.data->>'standInId' IS NOT NULL
      THEN COALESCE((d.data->>'standInAddedAfterSequence')::integer, d.sequence) + 1
    ELSE NULL
  END,
  false,
  d.sequence + CASE WHEN d.data->>'standInId' IS NOT NULL THEN 1 ELSE 0 END,
  CASE WHEN d.data->>'standInId' IS NOT NULL THEN 2 ELSE 1 END,
  GREATEST(
    (SELECT max(m.created_at) FROM pilot_dm_messages m WHERE m.thread_id = d.id),
    CASE WHEN d.data->>'standInId' IS NOT NULL THEN d.updated_at END
  ),
  d.team_id,
  d.created_at,
  d.updated_at
FROM pilot_dm_threads d
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "thread_participants" (
  "organization_id", "thread_id", "principal_id", "stand_in",
  "visible_from_sequence", "created_at", "updated_at"
)
SELECT d.organization_id, d.id, participant.principal_id, false, 1,
       d.created_at, d.updated_at
FROM pilot_dm_threads d
CROSS JOIN LATERAL (
  VALUES (d.participant_a_id), (d.participant_b_id)
) AS participant(principal_id)
ON CONFLICT ("thread_id", "principal_id") DO NOTHING;

INSERT INTO "thread_participants" (
  "organization_id", "thread_id", "principal_id", "stand_in",
  "visible_from_sequence", "created_at", "updated_at"
)
SELECT
  d.organization_id,
  d.id,
  (d.data->>'standInId')::uuid,
  true,
  COALESCE((d.data->>'standInAddedAfterSequence')::integer, d.sequence) + 1,
  d.created_at,
  d.updated_at
FROM pilot_dm_threads d
WHERE d.data->>'standInId' IS NOT NULL
ON CONFLICT ("thread_id", "principal_id") DO NOTHING;

INSERT INTO "messages" (
  "id", "organization_id", "thread_id", "sender_id", "client_message_id",
  "sequence", "kind", "body", "server_readable", "created_at", "updated_at"
)
SELECT
  m.id,
  m.organization_id,
  m.thread_id,
  m.sender_id,
  m.id,
  m.sequence + CASE
    WHEN d.data->>'standInId' IS NOT NULL
      AND m.sequence > COALESCE(
        (d.data->>'standInAddedAfterSequence')::integer,
        d.sequence
      )
      THEN 1
    ELSE 0
  END,
  'message',
  m.data->>'body',
  true,
  m.created_at,
  m.created_at
FROM pilot_dm_messages m
JOIN pilot_dm_threads d ON d.id = m.thread_id
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "messages" (
  "id", "organization_id", "thread_id", "sender_id", "client_message_id",
  "sequence", "kind", "body", "server_readable", "created_at", "updated_at"
)
SELECT
  overlay(
    overlay(
      md5(d.id::text || ':stand-in-access-boundary')
      placing '5' from 13 for 1
    )
    placing '8' from 17 for 1
  )::uuid,
  d.organization_id,
  d.id,
  d.participant_a_id,
  overlay(
    overlay(
      md5(d.id::text || ':stand-in-access-boundary')
      placing '5' from 13 for 1
    )
    placing '8' from 17 for 1
  )::uuid,
  COALESCE((d.data->>'standInAddedAfterSequence')::integer, d.sequence) + 1,
  'system_access_change',
  'A Stand-in joined. Messages from this point are Agent-readable.',
  true,
  d.updated_at,
  d.updated_at
FROM pilot_dm_threads d
WHERE d.data->>'standInId' IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

CREATE UNIQUE INDEX "messages_thread_sender_client_id_idx"
  ON "messages" ("thread_id", "sender_id", "client_message_id");

CREATE INDEX "messages_thread_sequence_desc_idx"
  ON "messages" ("thread_id", "sequence" DESC);

CREATE TABLE "outbox_publications" (
  "operation_id" uuid NOT NULL REFERENCES "outbox"("operation_id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "channel" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "available_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  "last_error_code" text,
  CONSTRAINT "outbox_publications_pk" PRIMARY KEY ("operation_id", "channel")
);

CREATE TABLE "stand_in_question_jobs" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "thread_id" uuid NOT NULL REFERENCES "threads"("id"),
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "stand_in_owner_id" uuid NOT NULL REFERENCES "principals"("id"),
  "asked_by_principal_id" uuid NOT NULL REFERENCES "principals"("id"),
  "question_message_id" uuid NOT NULL REFERENCES "messages"("id"),
  "answer_message_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "available_at" timestamp with time zone NOT NULL DEFAULT now(),
  "claimed_by" text,
  "claimed_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "last_error_code" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "stand_in_question_jobs_question_unique" UNIQUE ("question_message_id")
);

CREATE INDEX "stand_in_question_jobs_available_idx"
  ON "stand_in_question_jobs" ("available_at", "id")
  WHERE "status" IN ('pending', 'retrying');

CREATE INDEX "outbox_publications_available_idx"
  ON "outbox_publications" ("available_at", "operation_id")
  WHERE "completed_at" IS NULL;

ALTER TABLE "outbox_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_publications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "outbox_publications"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

ALTER TABLE "stand_in_question_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stand_in_question_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stand_in_question_jobs"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "outbox_publications" TO intero_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "stand_in_question_jobs" TO intero_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "outbox_publications" TO intero_worker;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "stand_in_question_jobs" TO intero_worker;
  END IF;
END
$$;
