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
