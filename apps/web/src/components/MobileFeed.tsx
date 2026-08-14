import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useState } from "react";
import BetterAuthHeader from "../integrations/better-auth/header-user";
import { FILTER_LABEL } from "../lib/constants/filters";
import { fmtCCU, fmtRelative } from "../lib/format";
import { type FeedPayload, FILTERS, type FilterValue } from "../lib/types";
import MobileCard from "./feed/MobileCard";
import { liveDotColor } from "./PulseCardParts";

const styles = {
  root: {
    background: "var(--surface-0)",
    color: "var(--text-2)",
    fontFamily: "var(--font-sans)",
    minHeight: "100vh",
    boxSizing: "border-box",
  } satisfies CSSProperties,
  topbar: {
    position: "sticky",
    top: 0,
    zIndex: 50,
    height: 48,
    padding: "0 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "rgba(12,12,13,0.85)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderBottom: "1px solid var(--border-1)",
  } satisfies CSSProperties,
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-1)",
    letterSpacing: "-0.01em",
  } satisfies CSSProperties,
  brandMark: {
    width: 22,
    height: 22,
    borderRadius: 6,
    background: "var(--text-1)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    color: "var(--surface-0)",
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
    flexShrink: 0,
  } satisfies CSSProperties,
  liveWrap: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: "var(--text-4)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
  header: {
    padding: "24px 22px 18px",
  } satisfies CSSProperties,
  kicker: {
    fontFamily: "var(--font-serif)",
    fontSize: 12,
    fontStyle: "italic",
    color: "var(--text-3)",
    letterSpacing: "0.02em",
    marginBottom: 6,
  } satisfies CSSProperties,
  title: {
    fontSize: 26,
    fontWeight: 500,
    letterSpacing: "-0.025em",
    color: "var(--text-1)",
    fontFamily: "var(--font-sans)",
    lineHeight: 1.05,
  } satisfies CSSProperties,
  marketRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 0,
    marginTop: 18,
    paddingTop: 14,
    borderTop: "1px solid var(--border-1)",
  } satisfies CSSProperties,
  marketCell: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,
  marketLabel: {
    fontSize: 10,
    color: "var(--text-4)",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    fontWeight: 500,
  } satisfies CSSProperties,
  marketValue: {
    fontSize: 15,
    color: "var(--text-1)",
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  } satisfies CSSProperties,
  filterRow: {
    position: "sticky",
    top: 48,
    zIndex: 19,
    background: "var(--surface-0)",
    display: "flex",
    gap: 8,
    padding: "12px 22px",
    overflowX: "auto",
    borderBottom: "1px solid var(--border-2)",
  } satisfies CSSProperties,
  feedList: {
    paddingBottom: 24,
  } satisfies CSSProperties,
  empty: {
    padding: "48px 22px",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
};

function filterChip(active: boolean): CSSProperties {
  return {
    fontSize: 12,
    padding: "6px 14px",
    borderRadius: 999,
    background: active ? "rgba(255,255,255,0.06)" : "transparent",
    color: active ? "var(--text-1)" : "var(--text-3)",
    border:
      "1px solid " +
      (active ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)"),
    cursor: "pointer",
    fontWeight: active ? 500 : 400,
    whiteSpace: "nowrap",
    flexShrink: 0,
    transition: "all 120ms ease",
  };
}

export default function MobileFeed({
  games,
  hero,
  kicker,
  liveSince,
  degradedMode: _degradedMode,
  jobHealth: _jobHealth,
  onSearchOpen,
}: FeedPayload & { onSearchOpen?: () => void }) {
  const search = useSearch({ from: "/" }) as { filter?: FilterValue };
  const navigate = useNavigate({ from: "/" });
  const isLoading = useRouterState({ select: (s) => s.isLoading });
  const filter: FilterValue = search.filter ?? "all";
  const setFilter = (value: FilterValue) =>
    navigate({ search: (s) => ({ ...s, filter: value }) });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const ageMs = Math.max(0, now - liveSince);
  const dotColor = liveDotColor(ageMs);

  return (
    <div style={styles.root}>
      <div style={styles.topbar}>
        <div style={styles.brand}>
          <span style={styles.brandMark}>L</span>
          Trend Lens
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {onSearchOpen && (
            <button
              type="button"
              onClick={onSearchOpen}
              aria-label="Search"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-3)",
                padding: 6,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </button>
          )}
          <div style={styles.liveWrap}>
            <span
              className={dotColor === "#22c55e" ? "live-dot-fresh" : undefined}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: dotColor,
                flexShrink: 0,
                transition: "background 200ms ease",
              }}
            />
            <span>Live · {fmtRelative(liveSince, now)}</span>
          </div>
          <BetterAuthHeader />
        </div>
      </div>

      <div style={styles.header}>
        <div style={styles.kicker}>{kicker}</div>
        <div style={styles.title}>
          What's moving
          <br />
          on Roblox today.
        </div>
        <div style={styles.marketRow}>
          <div style={styles.marketCell}>
            <span style={styles.marketLabel}>Tracked CCU</span>
            <span style={styles.marketValue}>
              {hero.trackedCcu === 0
                ? "—"
                : fmtCCU(hero.trackedCcu, { compact: true })}
            </span>
          </div>
          <div style={styles.marketCell}>
            <span style={styles.marketLabel}>Movers</span>
            <span style={styles.marketValue}>
              {games.length === 0 ? "—" : String(hero.movers)}
            </span>
          </div>
          <div style={styles.marketCell}>
            <span style={styles.marketLabel}>New · 48h</span>
            <span style={styles.marketValue}>
              {games.length === 0 ? "—" : String(hero.new48h)}
            </span>
          </div>
        </div>
      </div>

      <div style={styles.filterRow} className="no-scrollbar">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className="filter-chip"
            data-active={filter === value ? "true" : "false"}
            style={filterChip(filter === value)}
            onClick={() => setFilter(value)}
          >
            {FILTER_LABEL[value]}
          </button>
        ))}
      </div>

      {games.length === 0 ? (
        <div style={styles.empty}>
          <div style={{ fontSize: 14, color: "var(--text-2)" }}>
            The pulse is quiet.
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-5)",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
            }}
          >
            We'll tell you when something moves.
          </div>
        </div>
      ) : (
        <div
          style={{
            ...styles.feedList,
            opacity: isLoading ? 0.5 : 1,
            transition: "opacity 180ms ease",
            pointerEvents: isLoading ? "none" : "auto",
          }}
        >
          {games.map((g, i) => (
            <MobileCard key={g.id} game={g} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
