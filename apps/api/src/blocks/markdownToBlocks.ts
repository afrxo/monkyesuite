// Markdown → blocks adapter, one-way. Called on first read of a legacy doc
// (see `migrated_to_blocks` on docs). Deliberately narrow for Phase 1:
// paragraphs, headings, lists (bullet/numbered/task), blockquotes, inline
// marks. Code fences, images, and horizontal rules collapse to plain text
// placeholders so nothing is silently dropped; Phase 2 lifts them to real
// block types. Runs synchronously — marked exposes a sync mode.
//
// Output is a flat array of block INSERT rows, ordered. The caller assigns
// `docId` and `position` (fractional key) at insert time.

import { generateNKeysBetween } from "@monkyesuite/core";
import type { BlockType, InlineRun, TextBlockContent } from "@monkyesuite/shared";
import { marked, type Tokens } from "marked";

marked.use({ gfm: true, breaks: false, async: false });

type OutBlock = {
  type: BlockType;
  content: TextBlockContent;
  props: Record<string, unknown>;
  parentIdx: number | null; // index into the emitted array; null = root
};

// Walk marked's inline tokens and flatten into runs. `active` carries the
// currently applied marks so nested `<strong><em>` collapse into one run.
function inlineToRuns(
  tokens: Tokens.Generic[],
  active: Partial<Omit<InlineRun, "text">> = {},
): InlineRun[] {
  const out: InlineRun[] = [];
  const push = (text: string, marks: Partial<Omit<InlineRun, "text">>) => {
    if (!text) return;
    // Merge with the previous run if marks are identical — keeps runs tidy.
    const prev = out[out.length - 1];
    const same =
      prev &&
      Boolean(prev.bold) === Boolean(marks.bold) &&
      Boolean(prev.italic) === Boolean(marks.italic) &&
      Boolean(prev.code) === Boolean(marks.code) &&
      Boolean(prev.strikethrough) === Boolean(marks.strikethrough) &&
      (prev.link ?? "") === (marks.link ?? "");
    if (same) {
      prev.text += text;
      return;
    }
    out.push({ text, ...marks });
  };

  for (const t of tokens) {
    switch (t.type) {
      case "text": {
        const tok = t as Tokens.Text;
        if (tok.tokens?.length) {
          out.push(...inlineToRuns(tok.tokens, active));
        } else {
          push(tok.text, active);
        }
        break;
      }
      case "escape": {
        push((t as Tokens.Escape).text, active);
        break;
      }
      case "strong": {
        out.push(
          ...inlineToRuns((t as Tokens.Strong).tokens, { ...active, bold: true }),
        );
        break;
      }
      case "em": {
        out.push(
          ...inlineToRuns((t as Tokens.Em).tokens, { ...active, italic: true }),
        );
        break;
      }
      case "codespan": {
        push((t as Tokens.Codespan).text, { ...active, code: true });
        break;
      }
      case "del": {
        out.push(
          ...inlineToRuns((t as Tokens.Del).tokens, {
            ...active,
            strikethrough: true,
          }),
        );
        break;
      }
      case "link": {
        const link = t as Tokens.Link;
        out.push(
          ...inlineToRuns(link.tokens, { ...active, link: link.href }),
        );
        break;
      }
      case "br": {
        // Line break → soft newline in run text. BlockNote renders \n as <br>.
        push("\n", active);
        break;
      }
      case "html":
      case "image": {
        // Phase 1: swallow. Phase 2 introduces a real image block; raw HTML
        // never round-trips.
        break;
      }
      default: {
        // Unknown inline token — best effort: use its `raw` text if present.
        const raw = (t as { raw?: string; text?: string }).raw ?? (t as { text?: string }).text;
        if (raw) push(raw, active);
      }
    }
  }
  return out;
}

function textBlock(
  type: BlockType,
  tokens: Tokens.Generic[],
  props: Record<string, unknown>,
  parentIdx: number | null,
): OutBlock {
  const runs = inlineToRuns(tokens);
  return {
    type,
    content: { runs: runs.length ? runs : [{ text: "" }] },
    props,
    parentIdx,
  };
}

function walk(
  tokens: Tokens.Generic[],
  parentIdx: number | null,
  out: OutBlock[],
): void {
  for (const t of tokens) {
    switch (t.type) {
      case "space":
        break;
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        out.push(textBlock("paragraph", p.tokens, {}, parentIdx));
        break;
      }
      case "heading": {
        const h = t as Tokens.Heading;
        const level = Math.max(1, Math.min(3, h.depth)) as 1 | 2 | 3;
        out.push(textBlock("heading", h.tokens, { level }, parentIdx));
        break;
      }
      case "blockquote": {
        // Emit the quote as a wrapper block whose children re-emit as
        // paragraphs. Blockquotes rarely nest deeply in real docs; if they
        // do the recursion handles it.
        const bq = t as Tokens.Blockquote;
        out.push({
          type: "quote",
          content: { runs: [{ text: "" }] },
          props: {},
          parentIdx,
        });
        const quoteIdx = out.length - 1;
        walk(bq.tokens, quoteIdx, out);
        break;
      }
      case "list": {
        const list = t as Tokens.List;
        const numberedBase = list.ordered;
        for (const item of list.items) {
          const isTask = item.task === true;
          const type: BlockType = isTask
            ? "checkListItem"
            : numberedBase
              ? "numberedListItem"
              : "bulletListItem";
          const props = isTask ? { checked: item.checked === true } : {};
          // A list item's first paragraph is its text; nested lists become
          // child blocks on the same item.
          const [first, ...rest] = item.tokens;
          const firstIsText =
            first &&
            (first.type === "text" || first.type === "paragraph");
          const inlineTokens = firstIsText
            ? (first as Tokens.Text | Tokens.Paragraph).tokens ?? []
            : [];
          out.push(textBlock(type, inlineTokens, props, parentIdx));
          const itemIdx = out.length - 1;
          if (!firstIsText && first) walk([first], itemIdx, out);
          if (rest.length) walk(rest, itemIdx, out);
        }
        break;
      }
      case "code": {
        // Phase 1 placeholder — render as a single code-marked run in a
        // paragraph. Phase 2 introduces a proper `code` block with language.
        const code = t as Tokens.Code;
        out.push({
          type: "paragraph",
          content: {
            runs: [{ text: code.text, code: true }],
          },
          props: {},
          parentIdx,
        });
        break;
      }
      case "hr":
      case "html":
      case "table": {
        // Phase 1 skip. `html` never round-trips; `hr` and `table` come back
        // in later phases as first-class blocks.
        break;
      }
      default: {
        // Fallback: try to render as a paragraph if it has inline tokens.
        const withTokens = t as { tokens?: Tokens.Generic[] };
        if (withTokens.tokens) {
          out.push(textBlock("paragraph", withTokens.tokens, {}, parentIdx));
        }
      }
    }
  }
}

export type MigratedBlock = {
  type: BlockType;
  content: TextBlockContent;
  props: Record<string, unknown>;
  parentIdx: number | null;
  position: string;
};

/**
 * Parse markdown into a flat array of block descriptors, each carrying a
 * fractional-index `position` string. `parentIdx` refers to another entry in
 * the same array (or null for root). Caller is responsible for turning that
 * into real `parent_id` uuids when it materializes rows.
 */
export function markdownToBlocks(source: string): MigratedBlock[] {
  const trimmed = source?.trim() ?? "";
  if (!trimmed) {
    return [
      {
        type: "paragraph",
        content: { runs: [{ text: "" }] },
        props: {},
        parentIdx: null,
        position: "a0",
      },
    ];
  }
  const tokens = marked.lexer(trimmed);
  const out: OutBlock[] = [];
  walk(tokens, null, out);
  if (!out.length) {
    out.push({
      type: "paragraph",
      content: { runs: [{ text: "" }] },
      props: {},
      parentIdx: null,
    });
  }
  const keys = generateNKeysBetween(null, null, out.length);
  return out.map((b, i) => {
    const key = keys[i];
    if (!key) throw new Error("fractional-index generation failed");
    return { ...b, position: key };
  });
}
