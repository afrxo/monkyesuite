// Emoji slot on the doc header. Native input (no picker lib) — accepts one or
// two characters and trusts the OS emoji picker. Click empty state to focus.

import { useRef, useState } from "react";

export function DocIcon({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  if (!editing && !value) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true);
          setDraft("");
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="rounded px-1.5 py-0.5 text-[11px] text-text-disabled hover:bg-white/[0.05] hover:text-text-1"
      >
        + icon
      </button>
    );
  }
  if (!editing && value) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true);
          setDraft(value);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="grid h-8 w-8 place-items-center rounded text-[22px] hover:bg-white/[0.05]"
        aria-label="Change icon"
      >
        {value}
      </button>
    );
  }
  return (
    <input
      ref={inputRef}
      value={draft}
      maxLength={4}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        onChange(trimmed || null);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value ?? "");
          setEditing(false);
        }
      }}
      placeholder="😀"
      className="h-8 w-14 rounded border border-border-1 bg-surface-1 px-2 text-center text-[18px] outline-none focus:border-accent-warm"
    />
  );
}
