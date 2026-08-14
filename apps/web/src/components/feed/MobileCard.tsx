import { Link } from "@tanstack/react-router";
import {
  accelerationWord,
  Kicker,
  Thumb,
  VerifiedBadge,
} from "#/components/PulseCardParts";
import Sparkline from "#/components/Sparkline";
import {
  deltaColorVar,
  fmtCCU,
  fmtRank,
  fmtTrendPct,
  fmtVelocity,
} from "#/lib/format";
import { sparkColorFor, spikeTier } from "#/lib/spark";
import type { PulseCardGame } from "#/lib/types";

const WASH_MOBILE: Record<string, string> = {
  calm: "transparent",
  whisper: "transparent",
  speak: "linear-gradient(180deg, rgba(252, 211, 77, 0.025), transparent 60%)",
  shout: "linear-gradient(180deg, rgba(252, 211, 77, 0.05), transparent 70%)",
};

export default function MobileCard({
  game,
  index = 0,
}: {
  game: PulseCardGame;
  index?: number;
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
        display: "block",
        padding: "18px 22px 16px",
        borderBottom: "1px solid var(--border-2)",
        backgroundImage:
          WASH_MOBILE[tier] === "transparent" ? "none" : WASH_MOBILE[tier],
        textDecoration: "none",
        color: "inherit",
        position: "relative",
        ["--i" as never]: Math.min(index, 8),
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 6,
          left: 8,
          fontSize: 9,
          fontWeight: 500,
          color: "var(--text-5)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.1em",
        }}
      >
        {fmtRank(index)}
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <Thumb
          name={game.name}
          src={game.thumbnail}
          size={64}
          radius={12}
          className="pulse-thumb"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Kicker
            stage={game.lifecycle}
            reason={game.reason}
            trackingDays={game.trackingDays}
            reasonSize={12}
            sort={game.currentSort}
            sortRank={game.currentSortRank}
          />
          <div
            style={{
              fontSize: 15,
              fontWeight: 500,
              color: "var(--text-1)",
              letterSpacing: "-0.01em",
              marginTop: 8,
              marginBottom: 2,
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
              color: "var(--text-4)",
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
            {game.creatorVerified && <VerifiedBadge size={11} />}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 14,
          marginTop: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 32,
              fontWeight: 500,
              color: "var(--text-1)",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.035em",
              lineHeight: 0.95,
              fontFamily: "var(--font-sans)",
              whiteSpace: "nowrap",
            }}
          >
            {fmtCCU(game.ccu)}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              fontSize: 11,
              color: "var(--text-4)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontWeight: 500,
              marginTop: 2,
              whiteSpace: "nowrap",
            }}
          >
            <span>Concurrent</span>
            <span
              style={{
                color: deltaColor,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: 0,
                textTransform: "none",
                fontFamily: "var(--font-sans)",
              }}
            >
              {delta24hPct != null ? fmtTrendPct(delta24hPct) : "—"}
            </span>
            {delta24hAbs != null && (
              <span
                style={{
                  color: "var(--text-5)",
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: 0,
                  textTransform: "none",
                  fontFamily: "var(--font-sans)",
                }}
              >
                · {fmtVelocity(delta24hAbs)}
              </span>
            )}
            {delta24hAbs != null && accelWord && (
              <span
                style={{
                  color: "var(--text-4)",
                  letterSpacing: 0,
                  textTransform: "none",
                  fontFamily: "var(--font-sans)",
                  fontVariantNumeric: "normal",
                }}
              >
                · {accelWord}
              </span>
            )}
            {game.spike >= 1.5 && (
              <span
                style={{
                  color: "var(--text-5)",
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: 0,
                  textTransform: "none",
                  fontFamily: "var(--font-sans)",
                }}
              >
                · {game.spike.toFixed(1)}× spike
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <Sparkline
            data={game.spark}
            width={132}
            height={32}
            color={sparkColor}
          />
          <div
            style={{
              fontSize: 9,
              color: "var(--text-5)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontWeight: 500,
              opacity: 0.4,
            }}
          >
            24h
          </div>
        </div>
      </div>
    </Link>
  );
}
