-- Public OpenGraph/Twitter page metadata keyed by normalized URL.
-- This is not tenant data: rows never contain message bodies, cookies,
-- Authorization headers, or Organization/Thread identifiers.
CREATE TABLE "link_previews" (
  "url" text PRIMARY KEY,
  "status" text NOT NULL CHECK ("status" IN ('ok', 'failed', 'blocked')),
  "title" text,
  "description" text,
  "site_name" text,
  "image" text,
  "fetched_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "link_previews_expires_idx" ON "link_previews" ("expires_at");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "link_previews" TO intero_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "link_previews" TO intero_worker;
  END IF;
END
$$;
