import type { CSSProperties } from "react";

export const styles = {
  page: {
    minHeight: "100vh",
    background: "var(--surface-0)",
    color: "var(--text-1)",
    fontFamily: "var(--font-sans)",
    boxSizing: "border-box",
  } satisfies CSSProperties,
  hero: {
    padding: "40px 32px 28px",
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 40,
    alignItems: "end",
    borderBottom: "1px solid var(--border-1)",
  } satisfies CSSProperties,
  heroKicker: {
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
    fontSize: 20,
    color: "var(--text-3)",
    marginBottom: 12,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  heroTitle: {
    fontSize: 44,
    fontWeight: 500,
    letterSpacing: "-0.03em",
    color: "var(--text-1)",
    lineHeight: 1.0,
  } satisfies CSSProperties,
  heroSub: {
    fontSize: 14,
    color: "var(--text-4)",
    marginTop: 14,
    maxWidth: 560,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  heroStats: {
    display: "flex",
    gap: 36,
  } satisfies CSSProperties,
  heroStat: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  heroStatLabel: {
    fontSize: 10,
    color: "var(--text-4)",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    fontWeight: 500,
  } satisfies CSSProperties,
  heroStatValue: {
    fontSize: 22,
    fontWeight: 500,
    color: "var(--text-1)",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  heroStatDelta: {
    fontSize: 11,
    color: "var(--text-3)",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 500,
  } satisfies CSSProperties,
  body: {
    display: "grid",
    gridTemplateColumns: "1fr 320px",
  } satisfies CSSProperties,
  feedCol: {
    borderRight: "1px solid var(--border-1)",
    minHeight: 600,
    minWidth: 0,
  } satisfies CSSProperties,
  feedHeader: {
    padding: "20px 32px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid var(--border-2)",
    gap: 16,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  feedTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-1)",
  } satisfies CSSProperties,
  rail: {
    padding: "20px 24px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 28,
    minWidth: 0,
  } satisfies CSSProperties,
  railHeading: {
    fontSize: 12,
    color: "var(--text-3)",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    fontWeight: 600,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  emptyCard: {
    padding: "48px 32px",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
};

export const railSubhead: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: 12,
  color: "var(--text-4)",
  lineHeight: 1.4,
  marginTop: 2,
};

export const railBody: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontStyle: "normal",
  fontSize: 14,
  color: "var(--text-2)",
  lineHeight: 1.5,
};
