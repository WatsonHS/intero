CREATE TABLE "pilot_stand_in_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"work_state_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"job_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"queued_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"worker_id" text,
	"last_error_code" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_worker_heartbeats" (
	"organization_id" uuid NOT NULL,
	"worker_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_worker_heartbeats_organization_id_worker_id_pk" PRIMARY KEY("organization_id","worker_id")
);
--> statement-breakpoint
ALTER TABLE "pilot_work_states" ADD COLUMN "stand_in_job_id" uuid;--> statement-breakpoint
ALTER TABLE "pilot_work_states" ADD COLUMN "stand_in_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "pilot_stand_in_jobs" ADD CONSTRAINT "pilot_stand_in_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_stand_in_jobs" ADD CONSTRAINT "pilot_stand_in_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_stand_in_jobs" ADD CONSTRAINT "pilot_stand_in_jobs_work_state_id_pilot_work_states_id_fk" FOREIGN KEY ("work_state_id") REFERENCES "public"."pilot_work_states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_stand_in_jobs" ADD CONSTRAINT "pilot_stand_in_jobs_binding_id_pilot_agent_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."pilot_agent_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_worker_heartbeats" ADD CONSTRAINT "pilot_worker_heartbeats_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_stand_in_jobs_key_idx" ON "pilot_stand_in_jobs" USING btree ("organization_id","job_key");--> statement-breakpoint
CREATE INDEX "pilot_stand_in_jobs_pending_idx" ON "pilot_stand_in_jobs" USING btree ("organization_id","status","next_attempt_at","queued_at");--> statement-breakpoint
CREATE INDEX "pilot_stand_in_jobs_project_idx" ON "pilot_stand_in_jobs" USING btree ("project_id","queued_at");--> statement-breakpoint
CREATE INDEX "pilot_worker_heartbeats_freshness_idx" ON "pilot_worker_heartbeats" USING btree ("organization_id","last_heartbeat_at");
--> statement-breakpoint
ALTER TABLE "pilot_stand_in_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pilot_stand_in_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pilot_stand_in_jobs"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());
--> statement-breakpoint
ALTER TABLE "pilot_worker_heartbeats" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pilot_worker_heartbeats" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pilot_worker_heartbeats"
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());
