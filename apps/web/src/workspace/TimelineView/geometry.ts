// Shared geometry constants (CSS px at 1×). These set the rhythm that makes
// the view scannable and match the density of Board and List — not tunables.

export const AXIS_H = 52; // two tiers: 28 + 24
export const ROW_MS = 36;
export const ROW_TASK = 30;
export const TRACK_H = 8;
export const BAR_H = 20;
export const MARKER = 11; // task marker diamond
export const DIAMOND = 13; // milestone target diamond
export const MIN_BAR_W = 16; // below this a bar degrades to a marker
export const DRAG_THRESHOLD = 4;
export const EDGE_HIT = 8; // px resize zone; 0 when bar < 24px wide

export const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
