export default function StaleChip({ ageMinutes }: { ageMinutes: number }) {
  return (
    <span
      style={{
        fontSize: "10px",
        fontFamily: "var(--font-mono, monospace)",
        letterSpacing: "0.06em",
        color: "var(--text-4)",
        marginLeft: 4,
        flexShrink: 0,
      }}
    >
      STALE · {ageMinutes}m
    </span>
  );
}
