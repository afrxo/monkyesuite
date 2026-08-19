// Canvas-wide furniture: past shading, month/quarter rules, weekend banding,
// the today line. One absolutely-positioned element under the lanes
// (pointer-events: none); weekend bands are a single repeating gradient, not
// N divs. Recomputed only when [origin, end, zoom] changes.

import { axisTicks } from "./TimelineAxis";
import type { ZoomKey } from "./useTimelineScale";

export function TimelineOverlay({
  originDay,
  endDay,
  todayDay,
  zoom,
  x,
  gutterWidth,
  canvasWidth,
}: {
  originDay: number;
  endDay: number;
  todayDay: number;
  zoom: ZoomKey;
  x: (day: number) => number;
  gutterWidth: number;
  canvasWidth: number;
}) {
  const { rules } = axisTicks(originDay, endDay, zoom);
  const showWeekends = zoom === "week" || zoom === "day";
  const dw = zoom === "week" ? 18 : 44;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 z-[1]"
      style={{ left: gutterWidth, width: canvasWidth }}
    >
      {showWeekends ? (
        // Origin is snapped to a Monday, so Sat+Sun are days 5..7 of each
        // 7-day period from x=0.
        <div
          className="absolute inset-0"
          style={{
            background: `repeating-linear-gradient(to right, transparent 0 ${5 * dw}px, rgba(255,255,255,.02) ${5 * dw}px ${7 * dw}px)`,
          }}
        />
      ) : null}
      {rules.map((d) => (
        <div
          key={d}
          className="absolute inset-y-0 w-px bg-border-1"
          style={{ left: x(d) }}
        />
      ))}
      {/* the past recedes */}
      <div
        className="absolute inset-y-0 left-0"
        style={{
          width: Math.max(0, x(todayDay)),
          background: "rgba(0,0,0,.16)",
        }}
      />
      <div
        className="absolute inset-y-0 w-px"
        style={{ left: x(todayDay), background: "rgba(255,255,255,.30)" }}
      />
    </div>
  );
}
