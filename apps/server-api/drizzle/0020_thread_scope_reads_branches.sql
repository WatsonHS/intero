-- Conversation threads gain the three facts the UI needs to describe them:
-- the team they belong to, the thread they branched out of, and whether that
-- branch has been concluded back into its parent.
ALTER TABLE "threads"
  ADD COLUMN "team_id" uuid REFERENCES "pilot_teams"("id"),
  ADD COLUMN "parent_thread_id" uuid REFERENCES "threads"("id"),
  ADD COLUMN "concluded_at" timestamp with time zone,
  ADD COLUMN "concluded_by" uuid REFERENCES "principals"("id");

CREATE INDEX "threads_parent_idx" ON "threads" ("parent_thread_id");
CREATE INDEX "threads_team_idx" ON "threads" ("organization_id", "team_id");

-- Per-person read position. Unread is derived as "messages after this sequence
-- that I did not send", so it needs no counter to drift out of date.
CREATE TABLE "thread_reads" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "thread_id" uuid NOT NULL REFERENCES "threads"("id"),
  "principal_id" uuid NOT NULL REFERENCES "principals"("id"),
  "last_read_sequence" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "thread_reads_pk" PRIMARY KEY ("thread_id", "principal_id")
);

CREATE INDEX "thread_reads_principal_idx"
  ON "thread_reads" ("organization_id", "principal_id");

ALTER TABLE "thread_reads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thread_reads" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "thread_reads"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

-- Character-level spec annotations. The line range still anchors the block;
-- these offsets locate the run inside that block's rendered text.
ALTER TABLE "project_spec_comment_threads"
  ADD COLUMN "char_start" integer,
  ADD COLUMN "char_end" integer;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "thread_reads" TO intero_app;
  END IF;
END
$$;
