// Card-tag color palette. A ProjectTag either carries an explicit palette key
// (chosen by the user) or is null → a stable color derived from the tag id/name
// hash so labels stay visually distinct without asking the creator to pick.

import type { ProjectTag } from "@monkyesuite/shared";

// Kept small on purpose — a wider set becomes noise, not information.
export const TAG_PALETTE = [
  "combat",
  "ui",
  "audio",
  "net",
  "warm",
  "cool",
  "moss",
  "plum",
] as const;
export type TagColor = (typeof TAG_PALETTE)[number];

// bg wash + text color. Tokens live in styles.css; fallback keys reuse existing
// tag/accent tokens so no CSS change is needed to add the new labels feature.
export const TAG_CHIP: Record<TagColor, string> = {
  combat: "bg-tag-combat/10 text-tag-combat",
  ui: "bg-tag-ui/10 text-tag-ui",
  audio: "bg-tag-audio/10 text-tag-audio",
  net: "bg-tag-net/10 text-tag-net",
  warm: "bg-accent-warm-soft text-accent-warm",
  cool: "bg-tag-net/10 text-tag-net",
  moss: "bg-tag-audio/10 text-tag-audio",
  plum: "bg-tag-combat/10 text-tag-combat",
};

// FNV-1a-ish hash so a null color still resolves to a stable palette slot.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

export function tagColorOf(tag: ProjectTag): TagColor {
  if (tag.color && (TAG_PALETTE as readonly string[]).includes(tag.color)) {
    return tag.color as TagColor;
  }
  return TAG_PALETTE[hashStr(tag.id || tag.name) % TAG_PALETTE.length]!;
}

export function tagChipClass(tag: ProjectTag): string {
  return TAG_CHIP[tagColorOf(tag)];
}
