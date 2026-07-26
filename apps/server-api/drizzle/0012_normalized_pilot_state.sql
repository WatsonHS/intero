CREATE TABLE "pilot_agent_bindings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"credential_hash" text NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_agent_tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"client" text NOT NULL,
	"ticket_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_checkpoint_idempotency" (
	"organization_id" uuid NOT NULL,
	"client_event_id" text NOT NULL,
	"work_state_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_checkpoint_idempotency_organization_id_client_event_id_pk" PRIMARY KEY("organization_id","client_event_id")
);
--> statement-breakpoint
CREATE TABLE "pilot_coordination_participants" (
	"organization_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_coordination_participants_thread_id_principal_id_pk" PRIMARY KEY("thread_id","principal_id")
);
--> statement-breakpoint
CREATE TABLE "pilot_coordination_threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"work_state_id" uuid NOT NULL,
	"source_binding_id" uuid NOT NULL,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_deployment_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"administrator_id" uuid NOT NULL,
	"deployment_base_url" text NOT NULL,
	"deployment_validated_at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_dm_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_dm_threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"participant_a_id" uuid NOT NULL,
	"participant_b_id" uuid NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_private_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_state_id" uuid NOT NULL,
	"client_event_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_project_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"primary_team_id" uuid NOT NULL,
	"posture" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_project_teams" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_project_teams_project_id_team_id_pk" PRIMARY KEY("project_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "pilot_provider_configs" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"default_model" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_pulse_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"work_state_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"freshness_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_stand_in_exchanges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_team_join_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_team_memberships" (
	"organization_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_team_memberships_team_id_principal_id_pk" PRIMARY KEY("team_id","principal_id")
);
--> statement-breakpoint
CREATE TABLE "pilot_teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_work_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"workstream_key" text NOT NULL,
	"freshness_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pilot_agent_bindings" ADD CONSTRAINT "pilot_agent_bindings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_agent_bindings" ADD CONSTRAINT "pilot_agent_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_agent_bindings" ADD CONSTRAINT "pilot_agent_bindings_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_agent_tickets" ADD CONSTRAINT "pilot_agent_tickets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_agent_tickets" ADD CONSTRAINT "pilot_agent_tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_agent_tickets" ADD CONSTRAINT "pilot_agent_tickets_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_checkpoint_idempotency" ADD CONSTRAINT "pilot_checkpoint_idempotency_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_checkpoint_idempotency" ADD CONSTRAINT "pilot_checkpoint_idempotency_work_state_id_pilot_work_states_id_fk" FOREIGN KEY ("work_state_id") REFERENCES "public"."pilot_work_states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_coordination_participants" ADD CONSTRAINT "pilot_coordination_participants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_coordination_participants" ADD CONSTRAINT "pilot_coordination_participants_thread_id_pilot_coordination_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."pilot_coordination_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_coordination_participants" ADD CONSTRAINT "pilot_coordination_participants_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_coordination_threads" ADD CONSTRAINT "pilot_coordination_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_coordination_threads" ADD CONSTRAINT "pilot_coordination_threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_coordination_threads" ADD CONSTRAINT "pilot_coordination_threads_work_state_id_pilot_work_states_id_fk" FOREIGN KEY ("work_state_id") REFERENCES "public"."pilot_work_states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_coordination_threads" ADD CONSTRAINT "pilot_coordination_threads_source_binding_id_pilot_agent_bindings_id_fk" FOREIGN KEY ("source_binding_id") REFERENCES "public"."pilot_agent_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_deployment_settings" ADD CONSTRAINT "pilot_deployment_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_deployment_settings" ADD CONSTRAINT "pilot_deployment_settings_administrator_id_principals_id_fk" FOREIGN KEY ("administrator_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_dm_messages" ADD CONSTRAINT "pilot_dm_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_dm_messages" ADD CONSTRAINT "pilot_dm_messages_thread_id_pilot_dm_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."pilot_dm_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_dm_messages" ADD CONSTRAINT "pilot_dm_messages_sender_id_principals_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_dm_threads" ADD CONSTRAINT "pilot_dm_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_dm_threads" ADD CONSTRAINT "pilot_dm_threads_team_id_pilot_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."pilot_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_dm_threads" ADD CONSTRAINT "pilot_dm_threads_participant_a_id_principals_id_fk" FOREIGN KEY ("participant_a_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_dm_threads" ADD CONSTRAINT "pilot_dm_threads_participant_b_id_principals_id_fk" FOREIGN KEY ("participant_b_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_private_claims" ADD CONSTRAINT "pilot_private_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_private_claims" ADD CONSTRAINT "pilot_private_claims_work_state_id_pilot_work_states_id_fk" FOREIGN KEY ("work_state_id") REFERENCES "public"."pilot_work_states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_project_settings" ADD CONSTRAINT "pilot_project_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_project_settings" ADD CONSTRAINT "pilot_project_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_project_settings" ADD CONSTRAINT "pilot_project_settings_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_project_settings" ADD CONSTRAINT "pilot_project_settings_primary_team_id_pilot_teams_id_fk" FOREIGN KEY ("primary_team_id") REFERENCES "public"."pilot_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_project_teams" ADD CONSTRAINT "pilot_project_teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_project_teams" ADD CONSTRAINT "pilot_project_teams_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_project_teams" ADD CONSTRAINT "pilot_project_teams_team_id_pilot_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."pilot_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_provider_configs" ADD CONSTRAINT "pilot_provider_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_pulse_entries" ADD CONSTRAINT "pilot_pulse_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_pulse_entries" ADD CONSTRAINT "pilot_pulse_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_pulse_entries" ADD CONSTRAINT "pilot_pulse_entries_work_state_id_pilot_work_states_id_fk" FOREIGN KEY ("work_state_id") REFERENCES "public"."pilot_work_states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_pulse_entries" ADD CONSTRAINT "pilot_pulse_entries_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_stand_in_exchanges" ADD CONSTRAINT "pilot_stand_in_exchanges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_stand_in_exchanges" ADD CONSTRAINT "pilot_stand_in_exchanges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_stand_in_exchanges" ADD CONSTRAINT "pilot_stand_in_exchanges_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_team_join_links" ADD CONSTRAINT "pilot_team_join_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_team_join_links" ADD CONSTRAINT "pilot_team_join_links_team_id_pilot_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."pilot_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_team_memberships" ADD CONSTRAINT "pilot_team_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_team_memberships" ADD CONSTRAINT "pilot_team_memberships_team_id_pilot_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."pilot_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_team_memberships" ADD CONSTRAINT "pilot_team_memberships_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_teams" ADD CONSTRAINT "pilot_teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_work_states" ADD CONSTRAINT "pilot_work_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_work_states" ADD CONSTRAINT "pilot_work_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_work_states" ADD CONSTRAINT "pilot_work_states_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_work_states" ADD CONSTRAINT "pilot_work_states_binding_id_pilot_agent_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."pilot_agent_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_agent_bindings_credential_idx" ON "pilot_agent_bindings" USING btree ("credential_hash");--> statement-breakpoint
CREATE INDEX "pilot_agent_bindings_project_idx" ON "pilot_agent_bindings" USING btree ("project_id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_agent_tickets_hash_idx" ON "pilot_agent_tickets" USING btree ("ticket_hash");--> statement-breakpoint
CREATE INDEX "pilot_agent_tickets_project_idx" ON "pilot_agent_tickets" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "pilot_checkpoint_idempotency_expiry_idx" ON "pilot_checkpoint_idempotency" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pilot_coordination_participants_principal_idx" ON "pilot_coordination_participants" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "pilot_coordination_project_updated_idx" ON "pilot_coordination_threads" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "pilot_coordination_work_state_idx" ON "pilot_coordination_threads" USING btree ("work_state_id");--> statement-breakpoint
CREATE INDEX "pilot_deployment_admin_idx" ON "pilot_deployment_settings" USING btree ("administrator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_dm_messages_sequence_idx" ON "pilot_dm_messages" USING btree ("thread_id","sequence");--> statement-breakpoint
CREATE INDEX "pilot_dm_messages_org_created_idx" ON "pilot_dm_messages" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_dm_threads_participants_idx" ON "pilot_dm_threads" USING btree ("team_id","participant_a_id","participant_b_id");--> statement-breakpoint
CREATE INDEX "pilot_dm_threads_participant_a_idx" ON "pilot_dm_threads" USING btree ("participant_a_id");--> statement-breakpoint
CREATE INDEX "pilot_dm_threads_participant_b_idx" ON "pilot_dm_threads" USING btree ("participant_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_private_claims_event_idx" ON "pilot_private_claims" USING btree ("organization_id","client_event_id");--> statement-breakpoint
CREATE INDEX "pilot_private_claims_work_state_idx" ON "pilot_private_claims" USING btree ("work_state_id","observed_at");--> statement-breakpoint
CREATE INDEX "pilot_project_settings_org_owner_idx" ON "pilot_project_settings" USING btree ("organization_id","owner_id");--> statement-breakpoint
CREATE INDEX "pilot_project_teams_team_idx" ON "pilot_project_teams" USING btree ("team_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_pulse_entries_work_state_idx" ON "pilot_pulse_entries" USING btree ("work_state_id");--> statement-breakpoint
CREATE INDEX "pilot_pulse_entries_project_freshness_idx" ON "pilot_pulse_entries" USING btree ("project_id","freshness_at");--> statement-breakpoint
CREATE INDEX "pilot_stand_in_exchanges_project_principal_idx" ON "pilot_stand_in_exchanges" USING btree ("project_id","principal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_join_links_code_hash_idx" ON "pilot_team_join_links" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "pilot_join_links_team_idx" ON "pilot_team_join_links" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "pilot_team_memberships_principal_idx" ON "pilot_team_memberships" USING btree ("organization_id","principal_id");--> statement-breakpoint
CREATE INDEX "pilot_teams_org_name_idx" ON "pilot_teams" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_work_states_binding_workstream_idx" ON "pilot_work_states" USING btree ("binding_id","workstream_key");--> statement-breakpoint
CREATE INDEX "pilot_work_states_project_owner_idx" ON "pilot_work_states" USING btree ("project_id","owner_id","freshness_at");
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pilot_agent_bindings',
    'pilot_agent_tickets',
    'pilot_checkpoint_idempotency',
    'pilot_coordination_participants',
    'pilot_coordination_threads',
    'pilot_deployment_settings',
    'pilot_dm_messages',
    'pilot_dm_threads',
    'pilot_private_claims',
    'pilot_project_settings',
    'pilot_project_teams',
    'pilot_provider_configs',
    'pilot_pulse_entries',
    'pilot_stand_in_exchanges',
    'pilot_team_join_links',
    'pilot_team_memberships',
    'pilot_teams',
    'pilot_work_states'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = intero_current_organization_id()) WITH CHECK (organization_id = intero_current_organization_id())',
      table_name
    );
  END LOOP;
END
$$;
