type ThumbProps = {
  name: string;
  src: string | null;
  size?: number;
  radius?: number;
  className?: string;
};

export default function Thumb({
  name,
  src,
  size = 64,
  radius = 12,
  className,
}: ThumbProps) {
  const initial = ((name || "·")[0] ?? "·").toUpperCase();
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          objectFit: "cover",
          flexShrink: 0,
          background: "#1a1a1c",
        }}
      />
    );
  }
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "linear-gradient(135deg, #2a2a2d, #1a1a1c)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
        color: "var(--text-3)",
        fontSize: Math.round(size * 0.34),
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}
