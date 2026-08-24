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
  // Fewer than 2 points is not a sparkline — the previous fallback drew a
  // single 2px bar spanning the full width, which reads as a straight line
  // and silently masks upstream outages (empty spark from the API). Render
  // an empty box of the same footprint so layout stays intact.
  if (data.length < 2) {
    return <div style={{ width, height }} aria-hidden="true" />;
  }
  const max = Math.max(...data, 1);
  const barW = (width - (data.length - 1) * 2) / data.length;
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
        {data.map((v, i) => {
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
