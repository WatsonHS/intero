CREATE TABLE "presence_heartbeats" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "principal_id" uuid NOT NULL REFERENCES "principals"("id"),
  "last_seen_at" timestamptz NOT NULL,
  "last_active_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("organization_id", "principal_id")
);

ALTER TABLE "presence_heartbeats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "presence_heartbeats" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "presence_heartbeats"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

CREATE TABLE "platform_web_push_keys" (
  "organization_id" uuid PRIMARY KEY REFERENCES "organizations"("id"),
  "public_key" text NOT NULL,
  "private_key_encrypted" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "platform_web_push_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_web_push_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "platform_web_push_keys"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "presence_heartbeats" TO intero_app;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "platform_web_push_keys" TO intero_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_worker') THEN
    GRANT SELECT ON "platform_web_push_keys" TO intero_worker;
  END IF;
END $$;
