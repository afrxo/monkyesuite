import { Link } from "@tanstack/react-router";
import { copyGameLink } from "#/lib/clipboard";
import {
  deltaColorVar,
  fmtCCU,
  fmtRank,
  fmtTrendPct,
  fmtVelocity,
} from "#/lib/format";
import { sparkColorFor, spikeTier } from "#/lib/spark";
import type { PulseCardGame } from "#/lib/types";
import {
  accelerationWord,
  Kicker,
  Thumb,
  VerifiedBadge,
} from "../PulseCardParts";
import Sparkline from "../Sparkline";

function Chevron({
  size = 14,
  color,
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ShareIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
}

const WASH: Record<string, string> = {
  calm: "transparent",
  whisper: "transparent",
  speak: "linear-gradient(90deg, transparent 60%, rgba(252, 211, 77, 0.025))",
  shout: "linear-gradient(90deg, transparent 50%, rgba(252, 211, 77, 0.05))",
};

export default function DesktopCard({
  game,
  index = 0,
  activeSort = "spike",
}: {
  game: PulseCardGame;
  index?: number;
  activeSort?: string;
}) {
  const tier = spikeTier(game.spike, game.ccu);
  const delta24hAbs = game.ccu24hAgo != null ? game.ccu - game.ccu24hAgo : null;
  const delta24hPct =
    delta24hAbs != null && game.ccu24hAgo != null && game.ccu24hAgo > 0
      ? delta24hAbs / game.ccu24hAgo
      : null;
  const sparkColor = sparkColorFor(tier, (delta24hAbs ?? 0) >= 0);
  const deltaColor = deltaColorVar(delta24hPct);
  const accelWord = accelerationWord(game.velocityChange24hPct, delta24hPct);

  return (
    <Link
      to="/games/$id"
      params={{ id: String(game.id) }}
      className="pulse-card"
      style={{
        display: "grid",
        gridTemplateColumns: "18px 72px minmax(0, 1fr) 150px 200px 70px 130px",
        gap: 20,
        alignItems: "center",
        padding: "20px 32px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        backgroundImage: WASH[tier] === "transparent" ? "none" : WASH[tier],
        cursor: "pointer",
        textDecoration: "none",
        color: "inherit",
        ["--i" as never]: Math.min(index, 8),
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 500,
          color: "var(--text-5)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.08em",
          textAlign: "right",
          paddingRight: 2,
        }}
      >
        {fmtRank(index)}
      </div>

      <Thumb name={game.name} src={game.thumbnail} className="pulse-thumb" />

      <div
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          marginLeft: -8,
        }}
      >
        <Kicker
          stage={game.lifecycle}
          reason={game.reason}
          trackingDays={game.trackingDays}
          sort={game.currentSort}
          sortRank={game.currentSortRank}
        />
        <div
          style={{
            fontSize: 17,
            fontWeight: 500,
            color: "#fafaf9",
            letterSpacing: "-0.015em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {game.name}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#78716c",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {game.genre && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "var(--text-5)",
                flexShrink: 0,
              }}
            >
              {game.genre}
            </span>
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {game.creatorName}
          </span>
          {game.creatorVerified && <VerifiedBadge />}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div
          style={{
            fontSize: 28,
            fontWeight: 500,
            color: "#fafaf9",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.035em",
            lineHeight: 0.95,
            whiteSpace: "nowrap",
          }}
        >
          {fmtCCU(game.ccu)}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#78716c",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontWeight: 500,
            marginTop: 2,
            whiteSpace: "nowrap",
          }}
        >
          Concurrent
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Sparkline
          data={game.spark}
          width={196}
          height={40}
          color={sparkColor}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 9,
            color: "var(--text-5)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontWeight: 500,
            opacity: 0.4,
          }}
        >
          <span>24h ago</span>
          <span>now</span>
        </div>
      </div>

      {/* Spike micro-stat column: visible only when spike >= 1.5 (§4.2). The
          column itself stays in the grid template even when empty so the rest
          of the row keeps its alignment. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 2,
          justifyContent: "center",
          minWidth: 0,
        }}
      >
        {game.spike >= 1.5 ? (
          <>
            <div
              style={{
                fontSize: 14,
                color: "var(--text-2)",
                fontVariantNumeric: "tabular-nums",
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {game.spike.toFixed(1)}×
            </div>
            <div className="tl-caps">Spike</div>
          </>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 2,
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontSize: activeSort === "velocity" ? 20 : 15,
            color: deltaColor,
            fontVariantNumeric: "tabular-nums",
            fontWeight: activeSort === "velocity" ? 600 : 500,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "baseline",
            gap: 6,
          }}
        >
          <span>{delta24hPct != null ? fmtTrendPct(delta24hPct) : "—"}</span>
          {/* biome-ignore lint/a11y/useSemanticElements: the whole card is a
              <Link>, and a nested <button> inside an <a> is invalid HTML. The
              role + tabIndex + Enter/Space handler below is the correct
              substitute for an interactive control inside an anchor. */}
          <span
            role="button"
            tabIndex={0}
            aria-label="Copy link to game"
            title="Copy link"
            className="pulse-share"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void copyGameLink(game.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                void copyGameLink(game.id);
              }
            }}
          >
            <ShareIcon size={12} />
          </span>
          <Chevron size={16} className="pulse-chevron" />
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-5)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            letterSpacing: "0.01em",
            display: "flex",
            alignItems: "baseline",
            gap: 0,
          }}
        >
          {delta24hAbs != null && <span>{fmtVelocity(delta24hAbs)} CCU</span>}
          {delta24hAbs != null && accelWord && (
            <>
              <span style={{ color: "var(--text-5)", margin: "0 4px" }}>·</span>
              <span
                style={{ color: "var(--text-4)", fontVariantNumeric: "normal" }}
              >
                {accelWord}
              </span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
