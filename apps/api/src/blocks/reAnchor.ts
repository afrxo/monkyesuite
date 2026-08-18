// Re-anchor pass for saved-block updates. After a block is upserted, any
// anchored note whose `block_id` points at it (or its sibling doc) is checked
// against the fresh block text. If the anchor_quote still substring-matches
// somewhere in the block, the anchor's [start, end) offsets snap to the new
// position. If not, we try a normalized (case-folded, whitespace-collapsed)
// match to catch minor edits. Otherwise the note flips orphaned=true — still
// visible in the rail, but no longer highlighted in the editor.
//
// Kept synchronous inside the same tx that saves the blocks so callers can
// observe re-anchored notes on the next read without a second round trip.

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { blocks as blocksTable, notes } from "@monkyesuite/database";
import type { Tx } from "../tx.js";

// Extract flat text from a stored block content jsonb. Handles the two shapes
// this app persists: {runs:[{text,...}]} for text-bearing blocks and
// {text:"..."} for code blocks. Everything else yields "".
function flattenContent(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as { runs?: { text?: string }[]; text?: string };
  if (Array.isArray(c.runs)) {
    return c.runs.map((r) => r.text ?? "").join("");
  }
  if (typeof c.text === "string") return c.text;
  return "";
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function reAnchorNotesForBlocks(
  tx: Tx,
  docId: string,
  blockIds: string[],
): Promise<void> {
  if (!blockIds.length) return;
  // Load anchored notes that reference any of the touched blocks in this doc.
  const anchored = await tx
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.docId, docId),
        isNotNull(notes.blockId),
        isNotNull(notes.anchorQuote),
        inArray(notes.blockId, blockIds),
      ),
    );
  if (!anchored.length) return;

  const blockRows = await tx
    .select({
      id: blocksTable.id,
      content: blocksTable.content,
    })
    .from(blocksTable)
    .where(inArray(blocksTable.id, blockIds));
  const byId = new Map(blockRows.map((r) => [r.id, flattenContent(r.content)]));

  for (const note of anchored) {
    if (!note.blockId || !note.anchorQuote) continue;
    const text = byId.get(note.blockId);
    if (text === undefined) continue;

    let idx = text.indexOf(note.anchorQuote);
    if (idx === -1) {
      const nQuote = normalize(note.anchorQuote);
      const nText = normalize(text);
      const nIdx = nText.indexOf(nQuote);
      if (nIdx !== -1) {
        // Approximate — map the normalized index back to the raw text by
        // walking char-by-char. Not perfect, but close enough that hover
        // highlighting lands on the right span.
        let raw = 0;
        let norm = 0;
        while (norm < nIdx && raw < text.length) {
          norm += /\s/.test(text[raw] ?? "") ? 1 : 1;
          raw += 1;
        }
        idx = raw;
      }
    }

    if (idx === -1) {
      if (!note.orphaned) {
        await tx
          .update(notes)
          .set({ orphaned: true, updatedAt: new Date() })
          .where(eq(notes.id, note.id));
      }
      continue;
    }

    const newStart = idx;
    const newEnd = idx + note.anchorQuote.length;
    const shifted =
      note.anchorStart !== newStart ||
      note.anchorEnd !== newEnd ||
      note.orphaned;
    if (shifted) {
      await tx
        .update(notes)
        .set({
          anchorStart: newStart,
          anchorEnd: newEnd,
          orphaned: false,
          updatedAt: new Date(),
        })
        .where(eq(notes.id, note.id));
    }
  }
}
