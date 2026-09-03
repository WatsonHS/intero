ALTER TABLE "messages"
  ADD COLUMN "deleted_at" timestamptz;

ALTER TABLE "messages"
  ADD COLUMN "search_vector" tsvector
    GENERATED ALWAYS AS (
      CASE
        WHEN "deleted_at" IS NULL
         AND "server_readable" IS TRUE
         AND COALESCE("body", '') <> ''
        THEN to_tsvector('simple', "body")
        ELSE NULL
      END
    ) STORED;

CREATE INDEX "messages_search_vector_idx"
  ON "messages" USING gin ("search_vector")
  WHERE "search_vector" IS NOT NULL;
