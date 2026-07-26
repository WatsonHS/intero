CREATE TABLE "action_envelopes" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"workstream_id" uuid,
	"authority_grant_id" uuid NOT NULL,
	"action" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"source_ref" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canonical_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workstream_id" uuid,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"privacy" text NOT NULL,
	"safe_payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_participants" (
	"organization_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"stand_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_participants_thread_id_principal_id_pk" PRIMARY KEY("thread_id","principal_id")
);
--> statement-breakpoint
ALTER TABLE "action_envelopes" ADD CONSTRAINT "action_envelopes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_envelopes" ADD CONSTRAINT "action_envelopes_actor_id_principals_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_envelopes" ADD CONSTRAINT "action_envelopes_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_envelopes" ADD CONSTRAINT "action_envelopes_workstream_id_workstreams_id_fk" FOREIGN KEY ("workstream_id") REFERENCES "public"."workstreams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_envelopes" ADD CONSTRAINT "action_envelopes_authority_grant_id_capability_grants_id_fk" FOREIGN KEY ("authority_grant_id") REFERENCES "public"."capability_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_inbox" ADD CONSTRAINT "action_inbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_inbox" ADD CONSTRAINT "action_inbox_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_events" ADD CONSTRAINT "canonical_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_events" ADD CONSTRAINT "canonical_events_workstream_id_workstreams_id_fk" FOREIGN KEY ("workstream_id") REFERENCES "public"."workstreams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_envelopes_thread_idx" ON "action_envelopes" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "action_inbox_open_dedupe_idx" ON "action_inbox" USING btree ("organization_id","principal_id","dedupe_key") WHERE "action_inbox"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "action_inbox_principal_created_idx" ON "action_inbox" USING btree ("principal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_events_idempotency_idx" ON "canonical_events" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "canonical_events_workstream_idx" ON "canonical_events" USING btree ("workstream_id","occurred_at");