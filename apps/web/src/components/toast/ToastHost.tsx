import { useEffect, useRef, useState } from "react";
import { subscribe, type ToastEntry, type ToastVariant } from "./Toast";

const VARIANT_STYLES: Record<
  ToastVariant,
  { bar: string; icon: string; iconColor: string; bg: string; border: string }
> = {
  info: {
    bar: "bg-white/20",
    icon: "",
    iconColor: "",
    bg: "rgba(20,20,22,0.95)",
    border: "rgba(255,255,255,0.08)",
  },
  error: {
    bar: "bg-rose-500",
    icon: "⚠",
    iconColor: "var(--color-rose-400, #f87171)",
    bg: "rgba(30,10,12,0.97)",
    border: "rgba(248,113,113,0.25)",
  },
  success: {
    bar: "bg-emerald-500",
    icon: "✓",
    iconColor: "var(--color-emerald-400, #34d399)",
    bg: "rgba(10,22,16,0.97)",
    border: "rgba(52,211,153,0.25)",
  },
};

function Toast({
  entry,
  onDismiss,
}: {
  entry: ToastEntry;
  onDismiss: () => void;
}) {
  const s = VARIANT_STYLES[entry.variant];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(onDismiss, entry.duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [entry.duration, onDismiss]);

  const isInfo = entry.variant === "info";

  if (isInfo) {
    return (
      <div
        style={{
          padding: "10px 18px",
          borderRadius: 999,
          background: s.bg,
          color: "var(--text-1)",
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "-0.005em",
          boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
          border: `1px solid ${s.border}`,
          backdropFilter: "blur(8px)",
          animation: "tl-toast-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1)",
          pointerEvents: "auto",
        }}
      >
        {entry.message}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 10,
        background: s.bg,
        color: "var(--text-1)",
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: "-0.005em",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        border: `1px solid ${s.border}`,
        backdropFilter: "blur(10px)",
        animation: "tl-toast-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1)",
        maxWidth: 360,
        pointerEvents: "auto",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* left accent bar */}
      <div
        className={`${s.bar} absolute left-0 top-0 h-full w-[3px]`}
        style={{ borderRadius: "10px 0 0 10px" }}
      />
      {/* icon */}
      {s.icon ? (
        <span
          style={{
            color: s.iconColor,
            fontSize: 13,
            lineHeight: 1.6,
            flexShrink: 0,
            paddingLeft: 6,
          }}
        >
          {s.icon}
        </span>
      ) : null}
      {/* message */}
      <span style={{ flex: 1, lineHeight: 1.5, color: "var(--text-2)", paddingLeft: s.icon ? 0 : 6 }}>
        {entry.message}
      </span>
      {/* dismiss */}
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-disabled)",
          fontSize: 13,
          lineHeight: 1,
          padding: "2px 0",
          flexShrink: 0,
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

export default function ToastHost() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  useEffect(() => {
    return subscribe((t) => {
      setToasts((prev) => [...prev, t]);
    });
  }, []);

  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((x) => x.id !== id));

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <Toast key={t.id} entry={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}
