CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE auth_principals (
  auth_user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL UNIQUE REFERENCES principals(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX auth_principals_principal_idx ON auth_principals(principal_id);
