-- Block-native doc editor (Phase 1 of the DocEditor rewrite). Introduces the
-- `blocks` table + doc-level metadata (`migrated_to_blocks`, `icon`, `cover_url`).
-- Legacy `docs.body` markdown stays put so a re-migration is possible if the
-- parse ever improves.

CREATE TABLE "blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "doc_id" uuid NOT NULL REFERENCES "docs"("id") ON DELETE CASCADE,
  "parent_id" uuid REFERENCES "blocks"("id") ON DELETE CASCADE,
  "position" text NOT NULL,
  "type" text NOT NULL,
  "content" jsonb NOT NULL,
  "props" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "blocks_doc_position_idx"
  ON "blocks" ("doc_id", "position");
CREATE INDEX "blocks_doc_parent_position_idx"
  ON "blocks" ("doc_id", "parent_id", "position");

ALTER TABLE "blocks" ENABLE ROW LEVEL SECURITY;

-- Membership resolved via project_of_doc (functions.sql, SECURITY DEFINER) so
-- the block row can gate on the owning doc's project without RLS recursion.
CREATE POLICY "blocks_member_rw" ON "blocks"
  FOR ALL
  USING (is_project_member(project_of_doc(doc_id)))
  WITH CHECK (is_project_member(project_of_doc(doc_id)));

ALTER TABLE "docs"
  ADD COLUMN "migrated_to_blocks" boolean NOT NULL DEFAULT false,
  ADD COLUMN "icon" text,
  ADD COLUMN "cover_url" text;
