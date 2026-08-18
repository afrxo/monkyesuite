-- Anchored-note re-anchor status. When a save's re-anchor pass can no longer
-- locate the anchor_quote inside its owning block, the note flips orphaned=true
-- and surfaces with a banner instead of vanishing.

ALTER TABLE "notes" ADD COLUMN "orphaned" boolean NOT NULL DEFAULT false;
