import type { CSSProperties } from "react";
import type { LifecycleStage } from "#/lib/types";

export const LIFECYCLE_DOT: Record<LifecycleStage, string> = {
  new: "var(--lifecycle-new)",
  growing: "var(--lifecycle-growing)",
  peaking: "var(--lifecycle-peaking)",
  declining: "var(--lifecycle-declining)",
};

export const s = {
  panel: {
    background: "var(--surface-1)",
    border: "1px solid var(--border-1)",
    borderRadius: 12,
    overflow: "hidden",
    boxShadow: "0 24px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
    outline: "none",
  } satisfies CSSProperties,
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 16px",
  } satisfies CSSProperties,
  input: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    fontSize: 16,
    fontFamily: "var(--font-sans)",
    color: "var(--text-1)",
    caretColor: "var(--text-3)",
  } satisfies CSSProperties,
  spinner: {
    width: 14,
    height: 14,
    border: "2px solid var(--border-1)",
    borderTopColor: "var(--text-3)",
    borderRadius: "50%",
    animation: "search-spin 600ms linear infinite",
    flexShrink: 0,
  } satisfies CSSProperties,
  kbd: {
    fontSize: 10,
    color: "var(--text-5)",
    border: "1px solid var(--border-1)",
    padding: "1px 5px",
    borderRadius: 3,
    flexShrink: 0,
    fontFamily: "var(--font-sans)",
  } satisfies CSSProperties,
  divider: {
    height: 1,
    background: "var(--border-1)",
  } satisfies CSSProperties,
  resultsList: {
    maxHeight: 360,
    minHeight: 240,
    overflowY: "auto",
    padding: "6px 0",
  } satisfies CSSProperties,
  resultRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 16px",
    cursor: "pointer",
    transition: "background-color 80ms ease",
  } satisfies CSSProperties,
  resultInfo: {
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  resultName: {
    fontSize: 14,
    fontWeight: 500,
    color: "var(--text-2)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  resultMeta: {
    fontSize: 12,
    color: "var(--text-4)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 1,
  } satisfies CSSProperties,
  resultMetaText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  } satisfies CSSProperties,
  genreBadge: {
    fontSize: 9,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "var(--text-5)",
  } satisfies CSSProperties,
  resultRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  } satisfies CSSProperties,
  resultCcu: {
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    color: "var(--text-2)",
  } satisfies CSSProperties,
  emptyState: {
    padding: "24px 16px",
    textAlign: "center",
    fontSize: 13,
    color: "var(--text-4)",
  } satisfies CSSProperties,
  idleState: {
    padding: "24px 16px",
    textAlign: "center",
    fontSize: 13,
    color: "var(--text-5)",
  } satisfies CSSProperties,
  skelThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
    flexShrink: 0,
  } satisfies CSSProperties,
  skelLineMain: {
    height: 11,
    width: "55%",
    borderRadius: 4,
  } satisfies CSSProperties,
  skelLineSub: {
    height: 9,
    width: "35%",
    borderRadius: 4,
    marginTop: 6,
  } satisfies CSSProperties,
  skelCcu: {
    height: 11,
    width: 38,
    borderRadius: 4,
  } satisfies CSSProperties,
} as const;
