// Short human ID for a task, e.g. "SG-014". Derived from the task UUID's first
// 3 hex chars so it's stable without a schema change. Prefix comes from the
// project slug (first 2 letters, uppercased). Purely display — never used as
// a lookup key. Two tasks in the same project sharing prefix+hash is possible
// but extremely rare (~1 in 4096) and only cosmetic if it happens.

export function shortTaskId(projectSlug: string, taskId: string): string {
  const prefix = projectSlug
    .replace(/[^a-z]/gi, "")
    .slice(0, 2)
    .toUpperCase();
  const hex = taskId.replace(/-/g, "").slice(0, 3).toUpperCase();
  return `${prefix || "PR"}-${hex}`;
}

// Parse SG-### / SG-XXX refs out of a note body. Case-insensitive on the
// prefix and hex. Deduped, in first-seen order.
export function extractTaskRefs(body: string): string[] {
  const re = /\b([A-Z]{2,4})-([0-9A-F]{3,4})\b/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(re)) {
    if (!m[1] || !m[2]) continue;
    const ref = `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
    if (!seen.has(ref)) {
      seen.add(ref);
      out.push(ref);
    }
  }
  return out;
}

// Doc references live in a note body as an opaque `[[doc:<uuid>]]` token — a
// scheme that survives markdown storage untouched (marked leaves it as literal
// text) and can't collide with the SG-### card grammar above. The composer's @
// menu writes these; NoteItem extracts them into chips and rewrites them to a
// readable `@Title` for prose display.
const DOC_REF_RE =
  /\[\[doc:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi;

export function docRefToken(docId: string): string {
  return `[[doc:${docId}]]`;
}

// Extract doc uuids from a note body, deduped, in first-seen order.
export function extractDocRefs(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(DOC_REF_RE)) {
    const id = m[1]?.toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// Swap `[[doc:<uuid>]]` tokens for a readable `@Title` before the body is
// handed to marked — the raw token would otherwise render as literal text.
// `resolve` returns the doc's title, or undefined if it's been deleted.
export function replaceDocRefs(
  body: string,
  resolve: (docId: string) => string | undefined,
): string {
  return body.replace(DOC_REF_RE, (_full, id: string) => {
    const title = resolve(id.toLowerCase());
    return `@${title ?? "doc"}`;
  });
}
