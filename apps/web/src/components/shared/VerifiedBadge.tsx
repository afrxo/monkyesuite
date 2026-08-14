export default function VerifiedBadge({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="verified"
      style={{ flexShrink: 0, color: "#0166FF" }}
    >
      <path
        d="M12 2 14.5 4.5 18 5 19 8.5 22 11l-2 3 0 4-3.5.5L14.5 21 12 19l-2.5 2L7 19l-2.5-.5L5 14.5 2 11l3-2.5L6 5l3.5-.5z"
        fill="currentColor"
        opacity="0.85"
      />
      <path
        d="m9 12 2.2 2.2L15.5 9.9"
        stroke="var(--surface-0)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
