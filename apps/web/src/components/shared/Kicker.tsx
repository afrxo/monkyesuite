import LifecycleBadge from "#/components/LifecycleBadge";
import { sortLabel } from "#/lib/lifecycle";
import type { LifecycleStage } from "#/lib/types";

type KickerProps = {
  stage: LifecycleStage;
  reason: string;
  trackingDays: number;
  reasonSize?: number;
  sort?: string | null;
  sortRank?: number | null;
};

export default function Kicker({
  stage,
  reason,
  trackingDays,
  reasonSize = 13,
  sort,
  sortRank,
}: KickerProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      <LifecycleBadge
        stage={stage}
        reason={reason}
        trackingDays={trackingDays}
        reasonSize={reasonSize}
      />
      {sort && (
        <>
          <span style={{ color: "var(--text-5)", flexShrink: 0 }}>·</span>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: reasonSize,
              color: "var(--text-3)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            In {sortLabel(sort)}
            {sortRank !== null && sortRank !== undefined
              ? ` #${sortRank + 1}`
              : ""}
          </span>
        </>
      )}
    </div>
  );
}
