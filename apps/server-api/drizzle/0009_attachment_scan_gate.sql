CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  thread_id uuid NOT NULL REFERENCES threads(id),
  owner_id uuid NOT NULL REFERENCES principals(id),
  file_name text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 26214400),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  encryption_mode text NOT NULL CHECK (encryption_mode IN ('client_e2ee', 'server_envelope')),
  object_key text NOT NULL UNIQUE,
  state text NOT NULL CHECK (
    state IN ('pending_upload', 'uploaded', 'scanning', 'available', 'quarantined', 'scan_failed')
  ),
  scan_error_code text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX attachments_thread_state_idx ON attachments(thread_id, state);
--> statement-breakpoint
CREATE INDEX attachments_orphan_idx ON attachments(expires_at)
  WHERE state = 'pending_upload';
--> statement-breakpoint
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON attachments
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());
