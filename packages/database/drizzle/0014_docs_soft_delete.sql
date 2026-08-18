-- Soft-delete window for the client-side undo toast on docs. Reads filter
-- where deleted_at IS NULL. Restoration = set deleted_at = NULL.

ALTER TABLE "docs" ADD COLUMN "deleted_at" timestamptz;
CREATE INDEX "docs_deleted_idx" ON "docs" ("deleted_at");
