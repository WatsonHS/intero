ALTER TABLE "messages"
  ADD COLUMN "reply_to_message_id" uuid;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_reply_to_message_id_messages_id_fk"
  FOREIGN KEY ("reply_to_message_id")
  REFERENCES "messages"("id");

CREATE INDEX "messages_reply_to_message_idx"
  ON "messages" ("reply_to_message_id");
