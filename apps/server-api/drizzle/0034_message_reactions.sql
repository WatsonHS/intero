ALTER TABLE "messages"
  ADD COLUMN "reactions" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_reactions_array_check"
  CHECK (jsonb_typeof("reactions") = 'array');
