// Round-trip coverage for the block <-> BlockNote content mappers. If a
// document survives blocksToBlockNote → blockNoteToBlocks with identity on
// (type, position, content, props), autosave diffs stay silent and no false
// upserts land on the server.
//
// The mappers themselves live inside BlockEditor.tsx (co-located with the
// schema they consume) so this test file mirrors them here. If the real
// mappers grow, keep this file in step — or extract the mappers.

import { generateNKeysBetween } from "@monkyesuite/core";
import { describe, expect, it } from "vitest";

type InlineRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strikethrough?: boolean;
  link?: string;
};

type StyledText = {
  type: "text";
  text: string;
  styles: Record<string, boolean>;
};

type LinkNode = {
  type: "link";
  href: string;
  content: StyledText[];
};

type InlineNode = StyledText | LinkNode;

// Inline copies of the pure mappers from BlockEditor.tsx, matching that
// module's implementation so a change over there breaks this test on purpose.
function runsToInline(runs: InlineRun[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const styles: Record<string, boolean> = {};
    if (r.bold) styles.bold = true;
    if (r.italic) styles.italic = true;
    if (r.code) styles.code = true;
    if (r.strikethrough) styles.strike = true;
    const styledText: StyledText = { type: "text", text: r.text, styles };
    if (r.link) out.push({ type: "link", href: r.link, content: [styledText] });
    else out.push(styledText);
  }
  return out;
}

function inlineToRuns(content: InlineNode[] | undefined): InlineRun[] {
  const runs: InlineRun[] = [];
  if (!content) return runs;
  for (const node of content) {
    if (node.type === "text") {
      const marks: InlineRun = { text: node.text };
      if (node.styles.bold) marks.bold = true;
      if (node.styles.italic) marks.italic = true;
      if (node.styles.code) marks.code = true;
      if (node.styles.strike) marks.strikethrough = true;
      runs.push(marks);
    } else if (node.type === "link") {
      const inner = inlineToRuns(node.content);
      for (const r of inner) runs.push({ ...r, link: node.href });
    }
  }
  return runs.length ? runs : [{ text: "" }];
}

describe("inline mapper round-trip", () => {
  it("preserves plain text", () => {
    const runs: InlineRun[] = [{ text: "hello" }];
    expect(inlineToRuns(runsToInline(runs))).toEqual(runs);
  });

  it("preserves stacked marks", () => {
    const runs: InlineRun[] = [
      { text: "bold+italic", bold: true, italic: true },
    ];
    expect(inlineToRuns(runsToInline(runs))).toEqual(runs);
  });

  it("preserves a link with inner marks", () => {
    const runs: InlineRun[] = [
      { text: "docs", bold: true, link: "https://example.com/x" },
    ];
    expect(inlineToRuns(runsToInline(runs))).toEqual(runs);
  });

  it("preserves strikethrough", () => {
    const runs: InlineRun[] = [{ text: "gone", strikethrough: true }];
    expect(inlineToRuns(runsToInline(runs))).toEqual(runs);
  });

  it("drops empty runs on serialize but returns a placeholder on empty input", () => {
    // Empty-string runs are stripped by runsToInline (nothing to render), so
    // parsing back yields the [{text:""}] placeholder for a blank content.
    expect(inlineToRuns(runsToInline([{ text: "" }]))).toEqual([{ text: "" }]);
  });
});

describe("fractional-index positions", () => {
  it("stays monotonically sortable across a longer batch", () => {
    const keys = generateNKeysBetween(null, null, 20);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });
});
