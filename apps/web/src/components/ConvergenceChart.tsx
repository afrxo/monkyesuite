import { useEffect, useMemo, useRef, useState } from "react";
import type { GameMetric, LifecycleEvent, SortSnapshot } from "@monkyesuite/shared";
import { fmtCCUCompact, fmtRelative } from "../lib/format";

// Flags placed on the chart. Distinct color per kind so the legend reads at a
// glance without a separate key. Layered visibility is user-toggleable and
// persisted per session so the reader's chart state survives a route push.
export type EventFlag = {
  id: string;
  at: number;
  kind: "lifecycle" | "update" | "sort";
  label: string;
  color: string;
};

type Layers = {
  lifecycle: boolean;
  updates: boolean;
  sorts: boolean;
  peak: boolean;
};

const DEFAULT_LAYERS: Layers = {
  lifecycle: true,
  updates: true,
  sorts: false,
  peak: false,
};

const LS_KEY = "monkyesuite.chart.layers";

const KIND_COLOR: Record<EventFlag["kind"], string> = {
  lifecycle: "var(--lifecycle-peaking)",
  update: "#60a5fa",
  sort: "var(--text-3)",
};

export function buildEventFlags(
  lifecycle: LifecycleEvent[],
  sorts: SortSnapshot[],
): EventFlag[] {
  const out: EventFlag[] = [];
  for (const e of lifecycle) {
    const t = Date.parse(e.detectedAt);
    if (Number.isNaN(t)) continue;
    if (e.type === "update_shipped") {
      out.push({
        id: e.id,
        at: t,
        kind: "update",
        label: "Update shipped",
        color: KIND_COLOR.update,
      });
    } else if (e.type === "sort_appearance" || e.type === "sort_exit") {
      out.push({
        id: e.id,
        at: t,
        kind: "sort",
        label: e.type === "sort_appearance" ? "Entered sort" : "Left sort",
        color: KIND_COLOR.sort,
      });
    } else {
      out.push({
        id: e.id,
        at: t,
        kind: "lifecycle",
        label: e.type.replace(/_/g, " "),
        color: KIND_COLOR.lifecycle,
      });
    }
  }
  // Sort snapshots that changed sort or rank — first appearance per sort key.
  const seen = new Set<string>();
  for (const s of sorts) {
    if (seen.has(s.sortName)) continue;
    seen.add(s.sortName);
    const t = Date.parse(s.capturedAt);
    if (Number.isNaN(t)) continue;
    out.push({
      id: `sort-${s.sortName}-${s.capturedAt}`,
      at: t,
      kind: "sort",
      label: `${s.sortName.replace(/-/g, " ")} #${s.rank}`,
      color: KIND_COLOR.sort,
    });
  }
  return out;
}

export default function ConvergenceChart({
  points,
  flags,
  lineColor,
  windowHours,
}: {
  points: GameMetric[];
  flags: EventFlag[];
  lineColor: string;
  windowHours: number;
}) {
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [hover, setHover] = useState<{ x: number; y: number; idx: number } | null>(
    null,
  );
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(LS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<Layers>;
      setLayers((prev) => ({ ...prev, ...parsed }));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(LS_KEY, JSON.stringify(layers));
  }, [layers]);

  const chart = useMemo(() => {
    const w = 1000;
    const h = 200;
    const values = points.map((p) => p.playing ?? 0);
    const times = points.map((p) => Date.parse(p.capturedAt));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const tSpan = (times.at(-1) ?? 0) - (times[0] ?? 0) || 1;
    const t0 = times[0] ?? 0;
    const xAt = (t: number) => ((t - t0) / tSpan) * w;
    const yAt = (v: number) => h - ((v - min) / span) * (h - 12) - 6;
    const line = values
      .map((v, i) => `${xAt(times[i] ?? 0).toFixed(1)},${yAt(v).toFixed(1)}`)
      .join(" ");
    const area = `${xAt(t0)},${h} ${line} ${xAt(times.at(-1) ?? 0)},${h}`;
    const peak = { idx: values.indexOf(max), value: max };
    return { w, h, times, values, xAt, yAt, line, area, min, max, span, peak };
  }, [points]);

  const visibleFlags = useMemo(() => {
    return flags.filter((f) => {
      if (f.kind === "lifecycle") return layers.lifecycle;
      if (f.kind === "update") return layers.updates;
      if (f.kind === "sort") return layers.sorts;
      return false;
    });
  }, [flags, layers]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * chart.w;
    // find nearest metric
    let bestI = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < chart.times.length; i++) {
      const d = Math.abs(chart.xAt(chart.times[i] ?? 0) - x);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    const px = chart.xAt(chart.times[bestI] ?? 0);
    const py = chart.yAt(chart.values[bestI] ?? 0);
    setHover({ x: px, y: py, idx: bestI });
  }

  const hovered = hover != null ? points[hover.idx] : null;

  return (
    <div
      className="rounded-lg border border-border-1"
      style={{
        borderColor: "var(--border-1)",
        background:
          "linear-gradient(180deg, var(--surface-0) 0%, transparent 100%)",
      }}
    >
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${chart.w} ${chart.h}`}
          className="h-48 w-full"
          preserveAspectRatio="none"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
        >
          <title>CCU history</title>
          <defs>
            <linearGradient id="cc-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.28} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon points={chart.area} fill="url(#cc-area)" />
          <polyline
            points={chart.line}
            fill="none"
            stroke={lineColor}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {layers.peak && chart.peak.idx >= 0 ? (
            <line
              x1={0}
              x2={chart.w}
              y1={chart.yAt(chart.peak.value)}
              y2={chart.yAt(chart.peak.value)}
              stroke="var(--text-4)"
              strokeDasharray="3 3"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              opacity={0.55}
            />
          ) : null}
          {visibleFlags.map((f) => {
            const x = chart.xAt(f.at);
            if (x < 0 || x > chart.w) return null;
            return (
              <line
                key={f.id}
                x1={x}
                x2={x}
                y1={0}
                y2={chart.h}
                stroke={f.color}
                strokeOpacity={0.45}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {hover ? (
            <>
              <line
                x1={hover.x}
                x2={hover.x}
                y1={0}
                y2={chart.h}
                stroke="var(--text-3)"
                strokeOpacity={0.4}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={hover.x}
                cy={hover.y}
                r={3.5}
                fill={lineColor}
                stroke="var(--surface-0)"
                strokeWidth={1.5}
              />
            </>
          ) : null}
        </svg>
        {hovered ? (
          <div
            className="pointer-events-none absolute top-2 rounded-md border border-border-1 bg-surface-1 px-2 py-1 text-[11px] shadow-lg"
            style={{
              left: `min(calc(100% - 140px), ${(hover?.x ?? 0) / 10}%)`,
              borderColor: "var(--border-1)",
            }}
          >
            <div className="tabular-nums text-text-1">
              {fmtCCUCompact(hovered.playing ?? 0)} CCU
            </div>
            <div className="text-text-4">
              {fmtRelative(Date.parse(hovered.capturedAt), Date.now())}
            </div>
          </div>
        ) : null}
      </div>
      <XAxis times={chart.times} windowHours={windowHours} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-1 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <LayerPill
            active={layers.lifecycle}
            label="Lifecycle"
            color={KIND_COLOR.lifecycle}
            onToggle={() =>
              setLayers((l) => ({ ...l, lifecycle: !l.lifecycle }))
            }
          />
          <LayerPill
            active={layers.updates}
            label="Updates"
            color={KIND_COLOR.update}
            onToggle={() => setLayers((l) => ({ ...l, updates: !l.updates }))}
          />
          <LayerPill
            active={layers.sorts}
            label="Sorts"
            color={KIND_COLOR.sort}
            onToggle={() => setLayers((l) => ({ ...l, sorts: !l.sorts }))}
          />
          <LayerPill
            active={layers.peak}
            label="Peak"
            color="var(--text-3)"
            onToggle={() => setLayers((l) => ({ ...l, peak: !l.peak }))}
          />
        </div>
        <div className="text-[11px] text-text-5 tabular-nums">
          peak {fmtCCUCompact(chart.max)}
        </div>
      </div>
    </div>
  );
}

function LayerPill({
  active,
  label,
  color,
  onToggle,
}: {
  active: boolean;
  label: string;
  color: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition"
      style={{
        borderColor: active ? "var(--border-1)" : "transparent",
        background: active ? "var(--surface-hover)" : "transparent",
        color: active ? "var(--text-2)" : "var(--text-5)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 1,
          background: color,
          transform: "rotate(45deg)",
          opacity: active ? 0.9 : 0.4,
        }}
      />
      {label}
    </button>
  );
}

function XAxis({ times, windowHours }: { times: number[]; windowHours: number }) {
  const t0 = times[0] ?? 0;
  const t1 = times.at(-1) ?? 0;
  if (t1 <= t0) return null;
  const step = windowHours <= 48 ? 6 : windowHours <= 168 ? 24 : 72;
  const marks: { pct: number; label: string }[] = [];
  const startHour = new Date(t0).getHours();
  const alignedStart = t0 - startHour * 3_600_000; // align to day boundaries loosely
  for (let t = alignedStart; t <= t1; t += step * 3_600_000) {
    if (t < t0) continue;
    const pct = ((t - t0) / (t1 - t0)) * 100;
    marks.push({
      pct,
      label: new Date(t).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
      }),
    });
  }
  return (
    <div className="relative h-4 border-t border-border-1 text-[10px] text-text-5">
      {marks.map((m) => (
        <span
          key={m.pct}
          className="absolute -translate-x-1/2 pt-0.5"
          style={{ left: `${m.pct}%` }}
        >
          {m.label}
        </span>
      ))}
    </div>
  );
}
