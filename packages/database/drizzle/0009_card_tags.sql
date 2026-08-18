-- Card tags: per-project label vocabulary + task junction. Scoped (RLS via
-- is_project_member). Distinct from the GLOBAL `tags`/`game_tags` pair (which
-- describes games with a controlled 5-axis vocabulary) — these are free-form,
-- renameable, and live inside a single project.

CREATE TABLE "project_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text,
  "created_by" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "project_tags_project_name_uq"
  ON "project_tags" ("project_id", lower("name"));

ALTER TABLE "project_tags" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_tags_member_rw" ON "project_tags"
  FOR ALL
  USING (is_project_member(project_id))
  WITH CHECK (is_project_member(project_id));

CREATE TABLE "task_tags" (
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "tag_id" uuid NOT NULL REFERENCES "project_tags"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "added_by" text NOT NULL REFERENCES "users"("id"),
  "added_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("task_id", "tag_id")
);

CREATE INDEX "task_tags_tag_idx" ON "task_tags" ("tag_id");
CREATE INDEX "task_tags_project_idx" ON "task_tags" ("project_id");

ALTER TABLE "task_tags" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_tags_member_rw" ON "task_tags"
  FOR ALL
  USING (is_project_member(project_id))
  WITH CHECK (is_project_member(project_id));
