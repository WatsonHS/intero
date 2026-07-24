ALTER TABLE "claims" ADD COLUMN "valid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "supersedes" uuid;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "decided_by" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "specs" ADD COLUMN "review_thread_id" uuid;--> statement-breakpoint
ALTER TABLE "specs" ADD COLUMN "related_workstream_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "specs" ADD CONSTRAINT "specs_review_thread_id_threads_id_fk" FOREIGN KEY ("review_thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;