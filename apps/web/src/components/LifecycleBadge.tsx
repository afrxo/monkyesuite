import type { CSSProperties } from "react";
import { LIFECYCLE } from "../lib/lifecycle";
import type { LifecycleStage } from "../lib/types";

type Props = {
  stage: LifecycleStage;
  size?: "sm";
  reason?: string;
  trackingDays?: number;
  reasonSize?: number;
  layout?: "inline" | "stacked";
};

const PROVISIONAL_MIN_DAYS = 3;
const FULL_CONFIDENCE_DAYS = 14;

export default function LifecycleBadge({
  stage,
  size,
  reason = "",
  trackingDays = 0,
  reasonSize = 13,
  layout = "inline",
}: Props) {
  const meta = LIFECYCLE[stage];

  if (size === "sm") {
    return (
      <span
        style={{
          color: meta.color,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          fontSize: 10,
        }}
      >
        {meta.label}
      </span>
    );
  }

  const showKicker = trackingDays >= PROVISIONAL_MIN_DAYS;
  const showProvisionalChip =
    trackingDays >= PROVISIONAL_MIN_DAYS && trackingDays < FULL_CONFIDENCE_DAYS;

  const reasonTint: CSSProperties =
    stage === "declining"
      ? { color: "var(--text-5)" }
      : { color: `var(--lifecycle-${stage})` };

  const stageLabel = (
    <span
      style={{
        color: meta.color,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        fontSize: 10,
        flexShrink: 0,
      }}
    >
      {meta.label}
    </span>
  );

  const kicker = showKicker ? (
    <span
      style={{
        ...reasonTint,
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: reasonSize,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {reason}
    </span>
  ) : null;

  const chip = showProvisionalChip ? (
    <span className="tl-chip-meta">Early read</span>
  ) : null;

  if (layout === "stacked") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            minWidth: 0,
          }}
        >
          {stageLabel}
          {kicker}
        </div>
        {chip}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {stageLabel}
      {kicker}
      {chip}
    </div>
  );
}
