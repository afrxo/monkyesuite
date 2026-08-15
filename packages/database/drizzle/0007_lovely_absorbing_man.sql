CREATE TYPE "public"."task_activity_kind" AS ENUM('create', 'status_change', 'title_change', 'assignee_change', 'comment', 'attachment', 'checklist_add', 'checklist_complete');--> statement-breakpoint
CREATE TABLE "task_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"kind" "task_activity_kind" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"uploaded_by" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"r2_key" text NOT NULL,
	"thumbnail_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"order_key" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_activity_task_idx" ON "task_activity" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_activity_project_idx" ON "task_activity" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_attachments_r2_key_idx" ON "task_attachments" USING btree ("r2_key");--> statement-breakpoint
CREATE INDEX "task_attachments_task_idx" ON "task_attachments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_attachments_project_idx" ON "task_attachments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_checklist_task_idx" ON "task_checklist_items" USING btree ("task_id","order_key");--> statement-breakpoint
CREATE INDEX "task_checklist_project_idx" ON "task_checklist_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_comments_project_idx" ON "task_comments" USING btree ("project_id");--> statement-breakpoint
CREATE POLICY "task_activity_member_rw" ON "task_activity" AS PERMISSIVE FOR ALL TO public USING (is_project_member("task_activity"."project_id")) WITH CHECK (is_project_member("task_activity"."project_id"));--> statement-breakpoint
CREATE POLICY "task_attachments_member_rw" ON "task_attachments" AS PERMISSIVE FOR ALL TO public USING (is_project_member("task_attachments"."project_id")) WITH CHECK (is_project_member("task_attachments"."project_id"));--> statement-breakpoint
CREATE POLICY "task_checklist_member_rw" ON "task_checklist_items" AS PERMISSIVE FOR ALL TO public USING (is_project_member("task_checklist_items"."project_id")) WITH CHECK (is_project_member("task_checklist_items"."project_id"));--> statement-breakpoint
CREATE POLICY "task_comments_member_rw" ON "task_comments" AS PERMISSIVE FOR ALL TO public USING (is_project_member("task_comments"."project_id")) WITH CHECK (is_project_member("task_comments"."project_id"));