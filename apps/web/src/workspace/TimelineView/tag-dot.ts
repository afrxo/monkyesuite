// 5px tag dots for timeline gutter rows and tray chips — raw CSS color values
// for the same palette slots tagChipClass uses, since a dot has no text to
// carry the wash/text pair.

import type { ProjectTag } from "@monkyesuite/shared";
import { type TagColor, tagColorOf } from "../tag";

const TAG_DOT: Record<TagColor, string> = {
  combat: "var(--tag-combat)",
  ui: "var(--tag-ui)",
  audio: "var(--tag-audio)",
  net: "var(--tag-net)",
  warm: "var(--accent-warm)",
  cool: "var(--tag-net)",
  moss: "var(--tag-audio)",
  plum: "var(--tag-combat)",
};

export function tagDotColor(tag: ProjectTag): string {
  return TAG_DOT[tagColorOf(tag)];
}
