ALTER TABLE "stand_in_question_jobs"
  DROP CONSTRAINT "stand_in_question_jobs_question_unique";

ALTER TABLE "stand_in_question_jobs"
  ADD COLUMN "preferred_language" text NOT NULL DEFAULT 'en-US',
  ADD COLUMN "record_exchange" boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "stand_in_question_jobs_source_owner_unique"
  ON "stand_in_question_jobs" ("question_message_id", "stand_in_owner_id");
