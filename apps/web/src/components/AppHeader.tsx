import type { CSSProperties, ReactNode } from "react";
import BetterAuthHeader from "#/integrations/better-auth/header-user";
import { fmtRelative } from "#/lib/format";
import type { JobHealthRecord } from "#/lib/system-health";
import { computeSystemHealth } from "#/lib/system-health";

type ActiveRoute = "pulse" | "discover" | "watchlist" | "pricing";

type AppHeaderProps = {
  activeRoute?: ActiveRoute;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  onSearchOpen?: () => void;
  live?: {
    liveSince: number;
    now: number;
    jobHealth?: Record<string, JobHealthRecord>;
  };
};

const TONE_DOT: Partial<Record<string, string>> = {
  fresh: "var(--lifecycle-growing)",
  partial: "var(--lifecycle-peaking)",
  "snapshot-only": "var(--lifecycle-declining)",
  stale: "var(--text-4)",
};

// Feature nav — product destinations only. Pricing lives in the right rail as a CTA.
const NAV_ITEMS: { key: ActiveRoute; href: string; label: string }[] = [
  { key: "pulse", href: "/", label: "Pulse" },
  { key: "discover", href: "/discover", label: "Discover" },
  { key: "watchlist", href: "/watchlist", label: "Watchlist" },
];

const shell: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 50,
  height: 56,
  padding: "0 32px",
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  background: "rgba(12,12,13,0.85)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  borderBottom: "1px solid var(--border-1)",
  whiteSpace: "nowrap",
  fontFamily: "var(--font-sans)",
};

const leftWrap: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 32,
  minWidth: 0,
};

const brandStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-1)",
  letterSpacing: "-0.02em",
  textDecoration: "none",
  flexShrink: 0,
};

const brandPulse: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontWeight: 400,
  color: "var(--text-4)",
  fontSize: 14,
};

const navRowStyle: CSSProperties = {
  display: "flex",
  gap: 24,
  fontSize: 13,
};

const rightWrap: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  fontSize: 12,
  color: "var(--text-4)",
  flexShrink: 0,
};

const searchBoxStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--border-1)",
  borderRadius: 6,
  padding: "5px 32px 5px 10px",
  width: 280,
  fontSize: 12,
  color: "var(--text-4)",
  cursor: "pointer",
};

const kbdStyle: CSSProperties = {
  position: "absolute",
  right: 8,
  fontSize: 10,
  color: "var(--text-disabled)",
  border: "1px solid var(--border-1)",
  padding: "1px 5px",
  borderRadius: 3,
  letterSpacing: "0.02em",
};

function navItem(active: boolean): CSSProperties {
  return {
    color: active ? "var(--text-1)" : "var(--text-2)",
    fontWeight: active ? 500 : 400,
    paddingTop: 18,
    paddingBottom: 18,
    borderBottom: active
      ? "1.5px solid var(--text-1)"
      : "1.5px solid transparent",
    marginBottom: -1,
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
    letterSpacing: active ? "-0.01em" : undefined,
    transition: "color 120ms ease",
  };
}

export default function AppHeader({
  activeRoute,
  breadcrumb,
  actions,
  onSearchOpen,
  live,
}: AppHeaderProps) {
  const tone = live?.jobHealth
    ? computeSystemHealth(live.jobHealth).tone
    : "fresh";
  const dotColor = TONE_DOT[tone] ?? "var(--text-4)";
  const isFresh = tone === "fresh";

  const liveLabel = live
    ? `Live · ${fmtRelative(live.liveSince, live.now)}${tone === "partial" ? " · partial" : ""}`
    : null;

  return (
    <header style={shell}>
      <div style={leftWrap}>
        <a href="/" style={brandStyle}>
          <span>monkyesuite</span>
          <span style={brandPulse}>Pulse</span>
        </a>
        {breadcrumb ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
              color: "var(--text-3)",
              minWidth: 0,
              overflow: "hidden",
            }}
          >
            {breadcrumb}
          </div>
        ) : (
          <nav style={navRowStyle}>
            {NAV_ITEMS.map(({ key, href, label }) => (
              <a key={key} href={href} style={navItem(activeRoute === key)}>
                {label}
              </a>
            ))}
          </nav>
        )}
      </div>

      {/* Center column — search always occupies the middle grid cell */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        {onSearchOpen && (
          <button type="button" onClick={onSearchOpen} style={searchBoxStyle}>
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, opacity: 0.5 }}
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span>Search games, studios…</span>
            <span style={kbdStyle}>⌘K</span>
          </button>
        )}
      </div>

      <div style={{ ...rightWrap, justifySelf: "end" }}>
        {live && liveLabel && (
          <div
            title={
              live.jobHealth
                ? Object.entries(live.jobHealth)
                    .map(
                      ([name, h]) =>
                        `${name}: ${h.staleness === "degraded" ? "degraded" : "healthy"} · last run ${fmtRelative(h.succeededAt ?? h.ranAt, live.now)}`,
                    )
                    .join("\n")
                : undefined
            }
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              flexShrink: 0,
              cursor: "default",
              fontSize: 11,
              color: tone === "stale" ? "var(--text-4)" : "var(--text-3)",
            }}
          >
            <span
              className={isFresh ? "live-dot-fresh" : undefined}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: dotColor,
                flexShrink: 0,
                transition: "background 200ms ease",
              }}
            />
            <span>{liveLabel}</span>
          </div>
        )}

        {actions}

        <BetterAuthHeader />
      </div>
    </header>
  );
}
