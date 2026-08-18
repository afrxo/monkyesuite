-- Anchored notes (Phase 5, doc-editor rewrite). Extends the existing notes
-- table so project-level pins, doc-level notes, and block-anchored comments
-- all share one row shape + one RLS policy. `resolved` hides a note from the
-- default rail without deleting it.

ALTER TABLE "notes"
  ADD COLUMN "doc_id" uuid REFERENCES "docs"("id") ON DELETE CASCADE,
  ADD COLUMN "block_id" uuid REFERENCES "blocks"("id") ON DELETE SET NULL,
  ADD COLUMN "anchor_start" integer,
  ADD COLUMN "anchor_end" integer,
  ADD COLUMN "anchor_quote" text,
  ADD COLUMN "resolved" boolean NOT NULL DEFAULT false;

CREATE INDEX "notes_doc_idx" ON "notes" ("doc_id");
CREATE INDEX "notes_block_idx" ON "notes" ("block_id");
