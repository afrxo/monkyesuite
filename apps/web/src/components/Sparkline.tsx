export type { SpikeTier } from "../lib/spark";
export { sparkColorFor, spikeTier } from "../lib/spark";

type SparklineProps = {
  data?: number[];
  width?: number;
  height?: number;
  color?: string;
  showAxis?: boolean;
};

export default function Sparkline({
  data = [
    22, 24, 26, 25, 28, 31, 30, 33, 36, 38, 42, 45, 48, 52, 55, 60, 64, 71, 78,
    84, 88, 92, 96, 100,
  ],
  width = 200,
  height = 32,
  color,
  showAxis = false,
}: SparklineProps) {
  const safe = data.length > 0 ? data : [0];
  const max = Math.max(...safe, 1);
  const barW =
    safe.length > 1 ? (width - (safe.length - 1) * 2) / safe.length : width;
  const stroke = color ?? "var(--text-3)";

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className="block"
      >
        <line
          x1="0"
          y1={height - 0.5}
          x2={width}
          y2={height - 0.5}
          stroke="var(--border-3)"
          strokeWidth="1"
        />
        {safe.map((v, i) => {
          const h = Math.max(2, (v / max) * (height - 2));
          const x = i * (barW + 2);
          const y = height - h;
          return (
            <rect
              key={x}
              x={x}
              y={y}
              width={barW}
              height={h}
              fill={stroke}
              rx="0.5"
            />
          );
        })}
      </svg>
      {showAxis && (
        <div className="flex justify-between text-[9px] uppercase tracking-[0.1em] font-medium text-text-5">
          <span>24h ago</span>
          <span>now</span>
        </div>
      )}
    </div>
  );
}
