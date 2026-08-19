// A milestone's lane: derived track (display-only span — never persisted),
// done-fraction fill, target diamond, and the slip hatch — the one thing this
// view exists for: when contained work is due past the target, the track
// continues as a red diagonal hatch to the latest due date and the diamond
// takes the warning treatment.

import type { PointerEvent as ReactPointerEvent } from "react";
import { hexAlpha } from "../milestone-color";
import { DIAMOND, ROW_MS, TRACK_H } from "./geometry";
import type { DragLive, DragSpec } from "./useBarDrag";
import type { TimelineGroup } from "./useTimelineModel";

export function MilestoneTrack({
  group,
  x,
  dayWidth,
  editable,
  dragLive,
  startDrag,
}: {
  group: TimelineGroup;
  x: (day: number) => number;
  dayWidth: number;
  editable: boolean;
  dragLive: DragLive | null;
  startDrag: (e: ReactPointerEvent, spec: DragSpec) => void;
}) {
  const { colorHex, dashed, done, total } = group;
  const milestone = group.milestone;
  if (group.trackStart === null || group.trackEnd === null) return null;

  // Diamond drag preview.
  const dragging =
    dragLive?.engaged &&
    dragLive.spec.kind === "diamond" &&
    milestone &&
    dragLive.spec.milestoneId === milestone.id
      ? dragLive
      : null;
  const targetDay =
    group.targetDay !== null
      ? group.targetDay + (dragging?.dayDelta ?? 0)
      : null;

  const trackEnd =
    targetDay !== null ? Math.max(targetDay, group.trackStart) : group.trackEnd;
  const left = x(group.trackStart);
  const width = (trackEnd - group.trackStart + 1) * dayWidth;
  const dim = group.dimmed ? 0.4 : 1;
  const complete = total > 0 && done === total;
  const slip = group.slipEnd !== null && targetDay !== null;

  return (
    <div style={{ opacity: dim }}>
      <div
        className="absolute overflow-hidden"
        style={{
          left,
          width,
          height: TRACK_H,
          top: (ROW_MS - TRACK_H) / 2,
          borderRadius: 4,
          background: dashed ? "transparent" : hexAlpha(colorHex, 0.15),
          border: dashed ? `1px dashed ${hexAlpha(colorHex, 0.45)}` : undefined,
        }}
      >
        {!dashed && total > 0 ? (
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${(done / total) * 100}%`,
              background: hexAlpha(colorHex, 0.85),
            }}
          />
        ) : null}
      </div>
      {slip && group.slipEnd !== null && targetDay !== null ? (
        <div
          className="absolute"
          style={{
            left: x(targetDay + 1),
            width: (group.slipEnd - targetDay) * dayWidth,
            height: TRACK_H,
            top: (ROW_MS - TRACK_H) / 2,
            borderRadius: "0 4px 4px 0",
            background:
              "repeating-linear-gradient(45deg, rgba(240,87,111,.55) 0 2px, transparent 2px 5px)",
            borderTop: "1px solid rgba(240,87,111,.35)",
            borderBottom: "1px solid rgba(240,87,111,.35)",
          }}
          title={`Scheduled work runs ${group.slipEnd - targetDay}d past the target`}
        />
      ) : null}
      {targetDay !== null ? (
        <div
          className="absolute"
          data-tl-diamond={milestone?.id}
          style={{
            left: x(targetDay) + dayWidth / 2 - DIAMOND / 2,
            top: (ROW_MS - DIAMOND) / 2,
            width: DIAMOND,
            height: DIAMOND,
            transform: "rotate(45deg)",
            borderRadius: 2,
            border: slip
              ? "1.5px solid var(--destructive)"
              : `1.5px solid ${colorHex}`,
            background: slip
              ? "rgba(240,87,111,.18)"
              : complete
                ? colorHex
                : hexAlpha(colorHex, 0.14),
            cursor: editable ? (dragging ? "grabbing" : "grab") : undefined,
            zIndex: 3,
          }}
          title={
            slip
              ? `Target overrun — contained work is due ${group.slipEnd !== null && group.targetDay !== null ? group.slipEnd - group.targetDay : 0}d past this date`
              : "Target date — drag to move"
          }
          onPointerDown={
            editable && milestone && group.targetDay !== null
              ? (e) =>
                  startDrag(e, {
                    kind: "diamond",
                    milestoneId: milestone.id,
                    targetDay: group.targetDay ?? 0,
                  })
              : undefined
          }
        >
          {slip ? (
            <span
              className="absolute inset-0 grid place-items-center font-mono text-[8px] font-bold"
              style={{
                transform: "rotate(-45deg)",
                color: "var(--destructive)",
              }}
            >
              !
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
