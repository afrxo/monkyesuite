ALTER TYPE "public"."task_activity_kind" ADD VALUE 'schedule_change';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "start_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tasks_project_schedule_idx" ON "tasks" USING btree ("project_id","due_at") WHERE "tasks"."due_at" is not null;