-- Multi-assignee cards: replace tasks.assignee_id with a task_assignees
-- junction so a card can carry any number of members. Existing single-assignee
-- rows are backfilled into the junction before the column is dropped.

CREATE TABLE "task_assignees" (
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "added_by" text NOT NULL REFERENCES "users"("id"),
  "added_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("task_id", "user_id")
);

CREATE INDEX "task_assignees_user_idx" ON "task_assignees" ("user_id");
CREATE INDEX "task_assignees_project_idx" ON "task_assignees" ("project_id");

ALTER TABLE "task_assignees" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_assignees_member_rw" ON "task_assignees"
  FOR ALL
  USING (is_project_member(project_id))
  WITH CHECK (is_project_member(project_id));

-- Backfill from the legacy single-assignee column. added_by is best-effort:
-- fall back to the assignee themselves (they're already a member) so the NOT
-- NULL FK holds without inventing an actor.
INSERT INTO task_assignees (task_id, user_id, project_id, added_by, added_at)
SELECT id, assignee_id, project_id, assignee_id, created_at
FROM tasks
WHERE assignee_id IS NOT NULL;

DROP INDEX IF EXISTS "tasks_assignee_idx";
ALTER TABLE "tasks" DROP COLUMN "assignee_id";
