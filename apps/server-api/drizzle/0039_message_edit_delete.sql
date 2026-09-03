ALTER TABLE "messages"
  ADD COLUMN "edited_at" timestamptz,
  ADD COLUMN "deleted_at" timestamptz;
