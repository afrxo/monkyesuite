// Chart primitives for the Finances overview. The donuts and the revenue/spend
// combo use Recharts (already bundled via shadcn/ui); the small figures
// (sparkline, arc gauge, split bar) stay hand-rolled SVG. Everything inherits
// the finance tokens (--fin-positive / --fin-negative / --fin-alert / etc.).

import {
  Area,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtUsd, fmtUsdSigned } from "../../lib/format";

/** Polished Recharts donut with rounded, padded segments and a center slot. */
export function PieDonut({
  segments,
  size = 148,
  thickness = 22,
  center,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  center?: React.ReactNode;
}) {
  const outer = size / 2 - 2;
  const inner = outer - thickness;
  const data = segments.filter((s) => s.value > 0);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <PieChart width={size} height={size}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={inner}
          outerRadius={outer}
          startAngle={90}
          endAngle={-270}
          paddingAngle={data.length > 1 ? 2 : 0}
          cornerRadius={4}
          stroke="none"
          isAnimationActive={false}
        >
          {data.map((s) => (
            <Cell key={s.label} fill={s.color} />
          ))}
        </Pie>
      </PieChart>
      {center ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none">
          {center}
        </div>
      ) : null}
    </div>
  );
}

interface RevSpendPoint {
  month: string;
  label: string;
  revenue: number;
  spend: number;
  net: number;
  base: number; // min(revenue, spend) — the shared floor
  profit: number; // max(0, revenue − spend), stacked above base → tops at revenue
  loss: number; // max(0, spend − revenue), stacked above base → tops at spend
}

// Profit-gap area: a revenue line and a spend line, with the band between them
// filled — green when revenue leads (profit), red when spend leads (a loss
// month). The widening green wedge reads as "money kept". Clicking a month
// switches the page to it. Robust to the revenue ≫ spend scale gap.
export function RevenueSpendChart({
  series,
  activeMonth,
  onSelectMonth,
}: {
  series: {
    month: string;
    revenueUsd: number;
    spendUsd: number;
    netUsd: number;
  }[];
  activeMonth: string;
  onSelectMonth: (m: string) => void;
}) {
  const data: RevSpendPoint[] = series.map((s) => {
    const [, mm] = s.month.split("-");
    return {
      month: s.month,
      label: new Intl.DateTimeFormat("en-US", {
        month: "short",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(2020, Number(mm) - 1, 1))),
      revenue: s.revenueUsd,
      spend: s.spendUsd,
      net: s.netUsd,
      base: Math.min(s.revenueUsd, s.spendUsd),
      profit: Math.max(0, s.revenueUsd - s.spendUsd),
      loss: Math.max(0, s.spendUsd - s.revenueUsd),
    };
  });
  const activeLabel = data.find((d) => d.month === activeMonth)?.label;
  return (
    <ResponsiveContainer width="100%" height={190}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 6, bottom: 0, left: 6 }}
        onClick={(e) => {
          const pl = (
            e as unknown as {
              activePayload?: Array<{ payload: RevSpendPoint }>;
            }
          ).activePayload;
          const p = pl?.[0]?.payload;
          if (p) onSelectMonth(p.month);
        }}
      >
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--text-disabled)", fontSize: 10 }}
          interval={0}
          dy={4}
        />
        <YAxis hide domain={[0, "dataMax"]} />
        {activeLabel ? (
          <ReferenceLine
            x={activeLabel}
            stroke="rgba(255,255,255,0.18)"
            strokeDasharray="3 3"
          />
        ) : null}
        <Tooltip
          cursor={{ stroke: "rgba(255,255,255,0.14)" }}
          content={<RevSpendTooltip />}
        />
        {/* shared floor (transparent) — lifts the profit/loss bands to min */}
        <Area
          dataKey="base"
          stackId="band"
          stroke="none"
          fill="transparent"
          isAnimationActive={false}
        />
        <Area
          dataKey="profit"
          stackId="band"
          stroke="none"
          fill="var(--fin-positive)"
          fillOpacity={0.28}
          isAnimationActive={false}
        />
        <Area
          dataKey="loss"
          stackId="band"
          stroke="none"
          fill="var(--fin-alert)"
          fillOpacity={0.3}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="var(--fin-positive)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, fill: "var(--fin-positive)" }}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="spend"
          stroke="var(--fin-negative)"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3, fill: "var(--fin-negative)" }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function RevSpendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: RevSpendPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-md border border-border-2 bg-surface-1 px-2.5 py-1.5 font-mono text-[11px] tabular-nums shadow-lg">
      <div className="mb-1 text-text-2">{p.label}</div>
      <div className="text-fin-positive">rev {fmtUsd(p.revenue)}</div>
      <div className="text-fin-negative">spend {fmtUsd(p.spend)}</div>
      <div className={p.net >= 0 ? "text-fin-positive" : "text-fin-alert"}>
        {p.net >= 0 ? "profit" : "loss"} {fmtUsdSigned(p.net)}
      </div>
    </div>
  );
}

/** Compact trend line with a soft area fill. */
export function Sparkline({
  values,
  color,
  width = 200,
  height = 34,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <div style={{ height }} />;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / span) * height;
    return [x, Math.max(1, Math.min(height - 1, y))] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} ${width},${height} 0,${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={area} fill={color} opacity="0.09" />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 180° arc gauge — value as a proportion of max, with a center readout. */
export function ArcGauge({
  ratio,
  color,
  center,
  sub,
}: {
  ratio: number; // 0..1, clamped
  color: string;
  center: string;
  sub?: string;
}) {
  const r = 48;
  const cx = 60;
  const cy = 62;
  const clamped = Math.max(0, Math.min(1, ratio));
  // Sweep from 180° (left) to 0° (right).
  const angle = Math.PI * (1 - clamped);
  const ex = cx + r * Math.cos(angle);
  const ey = cy - r * Math.sin(angle);
  const track = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const fill = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  return (
    <svg viewBox="0 0 120 72" width="120" height="72" aria-hidden="true">
      <path
        d={track}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d={fill}
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <text
        x={cx}
        y="52"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="20"
        fill="var(--text-1)"
      >
        {center}
      </text>
      {sub ? (
        <text
          x={cx}
          y="64"
          textAnchor="middle"
          fontSize="9"
          fill="var(--text-4)"
        >
          {sub}
        </text>
      ) : null}
    </svg>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/** Horizontal stacked proportion bar. */
export function SplitBar({ segments }: { segments: DonutSegment[] }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      {segments.map((seg) => (
        <div
          key={seg.label}
          style={{
            width: `${(Math.max(0, seg.value) / total) * 100}%`,
            backgroundColor: seg.color,
          }}
        />
      ))}
    </div>
  );
}
