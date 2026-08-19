-- 0016 — intel_insights only.
--
-- NOTE: drizzle-kit generated this file with every change since 0007 re-emitted
-- (blocks, doc_folders, project_tags, task_assignees, task_tags, docs/notes
-- alters) because migrations 0008–0015 were hand-written without meta
-- snapshots. Those objects already exist in every environment, so the
-- duplicates were trimmed by hand. meta/0016_snapshot.json captures the FULL
-- current schema, so generates after this one diff cleanly again.
CREATE TABLE "intel_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_key" text NOT NULL,
	"rank" integer NOT NULL,
	"score" double precision NOT NULL,
	"headline" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "intel_insights_kind_subject_computed_uq" ON "intel_insights" USING btree ("kind","subject_key","computed_at");--> statement-breakpoint
CREATE INDEX "intel_insights_kind_computed_idx" ON "intel_insights" USING btree ("kind","computed_at");
