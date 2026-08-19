// Two-tier sticky axis. Major tier (months or years) + minor tier (quarter /
// month / week-start / day) per zoom preset. Today's cell is a filled
// high-contrast chip — deliberately achromatic: red, amber, and every
// milestone hue already mean something on this canvas.

import { dayToUtcDate, weekdayOf } from "../../lib/day";
import { AXIS_H, MONTH_ABBR } from "./geometry";
import type { ZoomKey } from "./useTimelineScale";

type Tick = { day: number; label: string };

function monthStarts(originDay: number, endDay: number): number[] {
  const out: number[] = [];
  for (let d = originDay; d <= endDay; d++) {
    if (dayToUtcDate(d).getUTCDate() === 1) out.push(d);
  }
  return out;
}

export function axisTicks(
  originDay: number,
  endDay: number,
  zoom: ZoomKey,
): { majors: Tick[]; minors: Tick[]; rules: number[] } {
  const months = monthStarts(originDay, endDay);
  const majors: Tick[] = [];
  const minors: Tick[] = [];
  let rules: number[] = [];

  if (zoom === "week" || zoom === "day") {
    // major = month, minor = week-start or day
    for (const d of months) {
      const t = dayToUtcDate(d);
      const m = t.getUTCMonth();
      majors.push({
        day: d,
        label:
          m === 0
            ? `${MONTH_ABBR[m]} ${t.getUTCFullYear()}`
            : (MONTH_ABBR[m] ?? ""),
      });
    }
    rules = months;
    if (zoom === "week") {
      for (let d = originDay; d <= endDay; d++) {
        if (weekdayOf(d) === 0)
          minors.push({ day: d, label: String(dayToUtcDate(d).getUTCDate()) });
      }
    } else {
      for (let d = originDay; d <= endDay; d++) {
        minors.push({ day: d, label: String(dayToUtcDate(d).getUTCDate()) });
      }
    }
  } else {
    // major = year, minor = month or quarter
    const first = dayToUtcDate(originDay);
    majors.push({ day: originDay, label: String(first.getUTCFullYear()) });
    for (const d of months) {
      const t = dayToUtcDate(d);
      if (t.getUTCMonth() === 0)
        majors.push({ day: d, label: String(t.getUTCFullYear()) });
    }
    if (zoom === "month") {
      for (const d of months)
        minors.push({
          day: d,
          label: MONTH_ABBR[dayToUtcDate(d).getUTCMonth()] ?? "",
        });
      rules = months;
    } else {
      for (const d of months) {
        const m = dayToUtcDate(d).getUTCMonth();
        if (m % 3 === 0)
          minors.push({ day: d, label: `Q${Math.floor(m / 3) + 1}` });
      }
      rules = minors.map((t) => t.day);
    }
  }
  return { majors, minors, rules };
}

export function TimelineAxis({
  originDay,
  endDay,
  todayDay,
  zoom,
  x,
  dayWidth,
}: {
  originDay: number;
  endDay: number;
  todayDay: number;
  zoom: ZoomKey;
  x: (day: number) => number;
  dayWidth: number;
}) {
  const { majors, minors, rules } = axisTicks(originDay, endDay, zoom);
  const t = dayToUtcDate(todayDay);
  return (
    <div
      className="sticky top-0 z-[4] border-b border-border-2 bg-surface-0"
      style={{ height: AXIS_H }}
    >
      {rules.map((d) => (
        <div
          key={`r${d}`}
          className="absolute bottom-0 top-6 w-px bg-border-1"
          style={{ left: x(d) }}
        />
      ))}
      {majors.map((m) => (
        <div
          key={`M${m.day}`}
          className="absolute top-[6px] pl-[7px] text-[11px] text-text-3"
          style={{ left: x(m.day) }}
        >
          {m.label}
        </div>
      ))}
      {minors.map((m) => (
        <div
          key={`m${m.day}`}
          className="absolute top-[31px] pl-[7px] font-mono text-[10px] text-text-disabled"
          style={{ left: x(m.day) }}
        >
          {m.label}
        </div>
      ))}
      <div
        className="absolute top-[28px] z-[6] -translate-x-1/2 whitespace-nowrap rounded bg-text-1 px-1.5 py-0.5 font-mono text-[10px] text-surface-0"
        style={{
          left: x(todayDay) + dayWidth / 2,
          background: "var(--text-1)",
          color: "var(--surface-0)",
        }}
        title="Today"
      >
        {MONTH_ABBR[t.getUTCMonth()]} {t.getUTCDate()}
      </div>
    </div>
  );
}
