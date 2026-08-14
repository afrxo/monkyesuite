import { useEffect, useState } from "react";
import { subscribe, type ToastEntry } from "./Toast";

export default function ToastHost() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  useEffect(() => {
    return subscribe((t) => {
      setToasts((prev) => [...prev, t]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 1800);
    });
  }, []);

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
        <div
          key={t.id}
          style={{
            padding: "10px 18px",
            borderRadius: 999,
            background: "rgba(20,20,22,0.92)",
            color: "var(--text-1)",
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: "-0.005em",
            boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(8px)",
            animation: "tl-toast-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1)",
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
