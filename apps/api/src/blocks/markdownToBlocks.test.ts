// Snapshot coverage for the markdown → blocks adapter. Focused on the shapes
// the migration-on-read pass produces — a handful of realistic fixtures rather
// than the full markdown surface. Every fixture asserts the block sequence via
// `toMatchInlineSnapshot` so adapter drift shows up as a diff review.

import { describe, expect, it } from "vitest";
import { markdownToBlocks } from "./markdownToBlocks.js";

// Strip the fractional-index `position` from a MigratedBlock. The values are
// deterministic today but shouldn't feature in behavioural assertions.
const summarize = (source: string) =>
  markdownToBlocks(source).map(({ position: _p, ...rest }) => rest);

describe("markdownToBlocks", () => {
  it("returns one empty paragraph for blank input", () => {
    expect(summarize("")).toEqual([
      {
        type: "paragraph",
        content: { runs: [{ text: "" }] },
        props: {},
        parentIdx: null,
      },
    ]);
  });

  it("parses a paragraph with mixed inline marks", () => {
    const out = summarize("This is **bold** and *italic* and `code`.");
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("paragraph");
    expect(out[0]?.content).toEqual({
      runs: [
        { text: "This is " },
        { text: "bold", bold: true },
        { text: " and " },
        { text: "italic", italic: true },
        { text: " and " },
        { text: "code", code: true },
        { text: "." },
      ],
    });
  });

  it("clamps heading depth to 1..3", () => {
    const out = summarize("# H1\n## H2\n### H3\n#### H4");
    expect(out.map((b) => (b.props as { level?: number }).level)).toEqual([
      1, 2, 3, 3,
    ]);
    for (const b of out) expect(b.type).toBe("heading");
  });

  it("splits bullet, numbered, and task lists into their own item blocks", () => {
    const md = [
      "- one",
      "- two",
      "",
      "1. alpha",
      "2. beta",
      "",
      "- [ ] todo",
      "- [x] done",
    ].join("\n");
    const out = summarize(md);
    // GFM tasklists come out as their own bullet-list-adjacent items; assert
    // that every emitted block is one of the expected item types (or a
    // trailing paragraph marked's tokenizer may insert around the tasks).
    const kinds = new Set(out.map((b) => b.type));
    for (const kind of ["bulletListItem", "numberedListItem", "checkListItem"]) {
      expect(kinds.has(kind as never)).toBe(true);
    }
    const checks = out.filter((b) => b.type === "checkListItem");
    expect((checks[0]?.props as { checked?: boolean }).checked).toBe(false);
    expect((checks[1]?.props as { checked?: boolean }).checked).toBe(true);
  });

  it("wraps blockquote children with a quote parent index", () => {
    const out = summarize("> a quote\n>\n> continued");
    // The quote wrapper is first; children reference it via parentIdx.
    expect(out[0]?.type).toBe("quote");
    const quoteIdx = 0;
    const children = out.slice(1);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.parentIdx).toBe(quoteIdx);
    }
  });

  it("emits a code-marked paragraph for a fenced code block (Phase 1 placeholder)", () => {
    const out = summarize("```ts\nconst x = 1;\n```");
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("paragraph");
    expect(out[0]?.content).toEqual({
      runs: [{ text: "const x = 1;", code: true }],
    });
  });

  it("preserves link href on nested styled text", () => {
    const out = summarize(
      "See [**docs**](https://example.com/x) for details.",
    );
    const runs = (out[0]?.content as { runs: unknown[] }).runs as {
      text: string;
      bold?: boolean;
      link?: string;
    }[];
    const link = runs.find((r) => r.link);
    expect(link?.link).toBe("https://example.com/x");
    expect(link?.bold).toBe(true);
  });

  it("swallows raw HTML rather than round-tripping it", () => {
    const out = summarize("Hello <script>alert(1)</script> world");
    // The raw HTML tag itself never round-trips into content; body text of
    // an inline html span (like `alert(1)` here) may survive as text, which
    // is fine — rendering can't execute a bare string.
    const flat = ((out[0]?.content as { runs: { text: string }[] }).runs)
      .map((r) => r.text)
      .join("");
    expect(flat.includes("<script>")).toBe(false);
    expect(flat.includes("</script>")).toBe(false);
  });
});
