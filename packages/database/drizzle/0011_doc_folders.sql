-- Doc folders (one level) + fractional-index ordering on docs. Existing docs
-- are backfilled with an order_key that preserves their current updated_at
-- sort so the sidebar visually stays put. Deleting a folder detaches its docs
-- (folder_id → null); it does not cascade to the docs themselves.

CREATE TABLE "doc_folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "order_key" text NOT NULL,
  "created_by" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "doc_folders_project_idx" ON "doc_folders" ("project_id", "order_key");

ALTER TABLE "doc_folders" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_folders_member_rw" ON "doc_folders"
  FOR ALL
  USING (is_project_member(project_id))
  WITH CHECK (is_project_member(project_id));

ALTER TABLE "docs"
  ADD COLUMN "folder_id" uuid REFERENCES "doc_folders"("id") ON DELETE SET NULL,
  ADD COLUMN "order_key" text;

-- Backfill: preserve current updated_at desc as the manual order. Uses a
-- letter+padded-int key that generateKeyBetween can extend on either side.
WITH ordered AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY project_id
      ORDER BY updated_at DESC, id
    ) AS rn
  FROM docs
)
UPDATE docs
SET order_key = 'a' || lpad(ordered.rn::text, 6, '0')
FROM ordered
WHERE docs.id = ordered.id;

ALTER TABLE "docs" ALTER COLUMN "order_key" SET NOT NULL;

CREATE INDEX "docs_project_folder_order_idx"
  ON "docs" ("project_id", "folder_id", "order_key");
