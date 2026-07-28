ALTER TABLE "messages"
  ADD COLUMN "mentioned_principal_ids" uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "stream_state" text NOT NULL DEFAULT 'complete',
  ADD COLUMN "revision" integer NOT NULL DEFAULT 1;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_stream_state_check"
  CHECK ("stream_state" IN ('pending', 'streaming', 'complete', 'failed'));

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_revision_check"
  CHECK ("revision" > 0);

CREATE INDEX "messages_mentions_idx"
  ON "messages" USING gin ("mentioned_principal_ids");

ALTER TABLE "attachments"
  ADD COLUMN "message_id" uuid;

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_message_id_messages_id_fk"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL;

CREATE INDEX "attachments_message_idx" ON "attachments" ("message_id")
  WHERE "message_id" IS NOT NULL;

DROP INDEX "attachments_orphan_idx";

CREATE INDEX "attachments_orphan_idx" ON "attachments" ("expires_at")
  WHERE "message_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "attachments" TO intero_app;
  END IF;
END
$$;
