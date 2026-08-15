// Card tag vocabulary — mirrors the tokens in styles.css (--tag-*). Kept small
// and closed: filter chips and card chips both draw from this list, and tags
// are derived from the task title (case-insensitive first-match). Widening it
// means adding a token + an entry here; no schema change.

export const TAG_KEYS = ["combat", "ui", "audio", "net"] as const;
export type TagKey = (typeof TAG_KEYS)[number];

const RE = new RegExp(`\\b(${TAG_KEYS.join("|")})\\b`, "i");

export function tagFromTitle(title: string): TagKey | null {
  const m = title.match(RE);
  if (!m?.[1]) return null;
  const k = m[1].toLowerCase() as TagKey;
  return TAG_KEYS.includes(k) ? k : null;
}

// Semantic color classes — background wash + text color. Hexes live in tokens.
export const TAG_CHIP: Record<TagKey, string> = {
  combat: "bg-tag-combat/10 text-tag-combat",
  ui: "bg-tag-ui/10 text-tag-ui",
  audio: "bg-tag-audio/10 text-tag-audio",
  net: "bg-tag-net/10 text-tag-net",
};
