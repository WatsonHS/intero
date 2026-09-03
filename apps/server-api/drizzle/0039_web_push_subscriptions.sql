ALTER TABLE "notification_preferences"
  ADD COLUMN "messages" text NOT NULL DEFAULT 'mentions';

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_messages_check" CHECK (
    "messages" IN ('all', 'mentions', 'none')
  );

CREATE TABLE "web_push_subscriptions" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "principal_id" uuid NOT NULL REFERENCES "principals"("id"),
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_idx"
  ON "web_push_subscriptions" ("organization_id", "endpoint");
CREATE INDEX "web_push_subscriptions_principal_idx"
  ON "web_push_subscriptions" ("organization_id", "principal_id");

ALTER TABLE "web_push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "web_push_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "web_push_subscriptions"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "web_push_subscriptions" TO intero_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_worker') THEN
    GRANT SELECT, DELETE ON "web_push_subscriptions" TO intero_worker;
    GRANT SELECT ON "notification_preferences" TO intero_worker;
  END IF;
END
$$;
