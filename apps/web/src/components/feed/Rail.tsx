import type { CSSProperties } from "react";
import { LIFECYCLE_ORDER } from "#/lib/constants/lifecycle-order";
import { LIFECYCLE } from "#/lib/lifecycle";
import type { RailPayload } from "#/lib/types";
import { railBody, railSubhead, styles } from "./PulseFeed.styles";

function RailSection({
  heading,
  subhead,
  subheadStyle,
  children,
}: {
  heading: string;
  subhead: string;
  subheadStyle?: CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
      }}
    >
      <div style={styles.railHeading}>{heading}</div>
      <div style={{ ...railSubhead, ...subheadStyle }}>{subhead}</div>
      <div>{children}</div>
    </div>
  );
}

function LifecycleSection({
  distribution,
}: {
  distribution: RailPayload["distribution"];
}) {
  const total = LIFECYCLE_ORDER.reduce((s, k) => s + distribution[k], 0);
  if (total === 0) return null;
  return (
    <RailSection
      heading="Lifecycle"
      subhead={`Where ${total} tracked games stand right now.`}
      subheadStyle={{ fontSize: 15, color: "#a8a29e" }}
    >
      <div
        style={{
          display: "flex",
          width: "100%",
          height: 8,
          borderRadius: 4,
          overflow: "hidden",
          background: "rgba(255,255,255,0.04)",
        }}
      >
        {LIFECYCLE_ORDER.map((k) => {
          const n = distribution[k];
          if (n === 0) return null;
          return (
            <span
              key={k}
              style={{
                flex: `${n} 0 0`,
                background: LIFECYCLE[k].color,
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 13,
          color: "#a8a29e",
          lineHeight: 1.6,
        }}
      >
        {LIFECYCLE_ORDER.map((k, i) => (
          <span key={k}>
            <span style={{ color: LIFECYCLE[k].color, fontWeight: 500 }}>
              {distribution[k]}
            </span>{" "}
            {LIFECYCLE[k].label.toLowerCase()}
            {i < LIFECYCLE_ORDER.length - 1 && (
              <span style={{ color: "#44403c", margin: "0 6px" }}>·</span>
            )}
          </span>
        ))}
      </div>
    </RailSection>
  );
}

function TransitionsSection({
  transitions,
}: {
  transitions: RailPayload["transitions6h"];
}) {
  const lines: { color: string; n: number; suffix: string }[] = [];
  if (transitions.toPeaking > 0) {
    lines.push({
      color: LIFECYCLE.peaking.color,
      n: transitions.toPeaking,
      suffix: ` ${transitions.toPeaking === 1 ? "game" : "games"} moved to peaking.`,
    });
  }
  if (transitions.toDeclining > 0) {
    lines.push({
      color: LIFECYCLE.declining.color,
      n: transitions.toDeclining,
      suffix: " dropped to declining.",
    });
  }
  if (transitions.toGrowing > 0) {
    lines.push({
      color: LIFECYCLE.growing.color,
      n: transitions.toGrowing,
      suffix: " climbed back to growing.",
    });
  }
  return (
    <RailSection
      heading="Last 6h"
      subhead="What just moved."
      subheadStyle={{ fontSize: 15, color: "#a8a29e" }}
    >
      {lines.length === 0 ? (
        <div style={{ ...railBody, color: "#78716c" }}>
          No lifecycle changes in the last 6 hours.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {lines.map((l) => (
            <div key={l.suffix} style={railBody}>
              <span style={{ color: l.color, fontWeight: 500 }}>{l.n}</span>
              {l.suffix}
            </div>
          ))}
        </div>
      )}
    </RailSection>
  );
}

export default function Rail({ rail }: { rail: RailPayload }) {
  return (
    <div style={styles.rail}>
      {rail.signal && (
        <RailSection
          heading={rail.signal.label}
          subhead="What stands out today."
          subheadStyle={{ fontSize: 15, color: "#a8a29e" }}
        >
          <div style={railBody}>{rail.signal.text}</div>
        </RailSection>
      )}
      <LifecycleSection distribution={rail.distribution} />
      <TransitionsSection transitions={rail.transitions6h} />
    </div>
  );
}
