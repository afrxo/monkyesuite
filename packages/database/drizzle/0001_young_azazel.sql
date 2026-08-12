-- Rewrites the scoped RLS policies to call is_project_member / is_project_owner
-- instead of inlining `exists (select … from memberships …)` (which recursed).
-- The functions themselves are NOT defined here — they live in functions.sql,
-- which db:migrate applies before this migration. See functions.sql for why.
ALTER POLICY "docs_member_rw" ON "docs" TO public USING (is_project_member("docs"."project_id")) WITH CHECK (is_project_member("docs"."project_id"));--> statement-breakpoint
ALTER POLICY "invites_member_rw" ON "invites" TO public USING (is_project_member("invites"."project_id"));--> statement-breakpoint
ALTER POLICY "memberships_select" ON "memberships" TO public USING (is_project_member("memberships"."project_id"));--> statement-breakpoint
ALTER POLICY "milestones_member_rw" ON "milestones" TO public USING (is_project_member("milestones"."project_id")) WITH CHECK (is_project_member("milestones"."project_id"));--> statement-breakpoint
ALTER POLICY "notes_member_rw" ON "notes" TO public USING (is_project_member("notes"."project_id")) WITH CHECK (is_project_member("notes"."project_id"));--> statement-breakpoint
ALTER POLICY "project_game_member_rw" ON "project_game" TO public USING (is_project_member("project_game"."project_id")) WITH CHECK (is_project_member("project_game"."project_id"));--> statement-breakpoint
ALTER POLICY "projects_select" ON "projects" TO public USING (is_project_member("projects"."id"));--> statement-breakpoint
ALTER POLICY "projects_update" ON "projects" TO public USING (is_project_owner("projects"."id"));--> statement-breakpoint
ALTER POLICY "projects_delete" ON "projects" TO public USING (is_project_owner("projects"."id"));--> statement-breakpoint
ALTER POLICY "tasks_member_rw" ON "tasks" TO public USING (is_project_member("tasks"."project_id")) WITH CHECK (is_project_member("tasks"."project_id"));