CREATE TABLE "kanban_card_workstreams" (
	"organization_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"workstream_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kanban_card_workstreams_card_id_workstream_id_pk" PRIMARY KEY("card_id","workstream_id")
);
--> statement-breakpoint
CREATE TABLE "kanban_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"column" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"owner_id" uuid,
	"estimate_points" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kanban_card_workstreams" ADD CONSTRAINT "kanban_card_workstreams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_card_workstreams" ADD CONSTRAINT "kanban_card_workstreams_card_id_kanban_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."kanban_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_card_workstreams" ADD CONSTRAINT "kanban_card_workstreams_workstream_id_workstreams_id_fk" FOREIGN KEY ("workstream_id") REFERENCES "public"."workstreams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kanban_card_workstreams_workstream_idx" ON "kanban_card_workstreams" USING btree ("workstream_id");--> statement-breakpoint
CREATE INDEX "kanban_cards_project_column_idx" ON "kanban_cards" USING btree ("project_id","column","position");--> statement-breakpoint
CREATE INDEX "kanban_cards_owner_idx" ON "kanban_cards" USING btree ("owner_id");--> statement-breakpoint

ALTER TABLE kanban_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kanban_cards
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());--> statement-breakpoint

ALTER TABLE kanban_card_workstreams ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_card_workstreams FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kanban_card_workstreams
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());
