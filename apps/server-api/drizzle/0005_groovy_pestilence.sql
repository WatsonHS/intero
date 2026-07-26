CREATE TABLE "public_stand_in_runs" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"workstream_id" uuid,
	"status" text NOT NULL,
	"freshness_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
ALTER TABLE "public_stand_in_runs" ADD CONSTRAINT "public_stand_in_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_stand_in_runs" ADD CONSTRAINT "public_stand_in_runs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_stand_in_runs" ADD CONSTRAINT "public_stand_in_runs_workstream_id_workstreams_id_fk" FOREIGN KEY ("workstream_id") REFERENCES "public"."workstreams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_stand_in_runs_status_idx" ON "public_stand_in_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_operation_idx" ON "messages" USING btree ("organization_id","operation_id");