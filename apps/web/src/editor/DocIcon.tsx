// Emoji slot for the doc header. Click reveals a popover picker
// (emoji-picker-react) themed against the workspace tokens; selection sets
// the doc icon and closes. Click outside or Escape dismisses without change.

import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import { useEffect, useRef, useState } from "react";

export function DocIcon({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      {value ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid h-8 w-8 place-items-center rounded text-[22px] hover:bg-white/[0.05]"
          aria-label="Change icon"
        >
          {value}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded px-1.5 py-0.5 text-[11px] text-text-disabled hover:bg-white/[0.05] hover:text-text-1"
        >
          + icon
        </button>
      )}
      {open ? (
        <div className="absolute left-0 top-9 z-20 rounded-md border border-border-1 bg-surface-1 shadow-xl">
          <EmojiPicker
            theme={Theme.DARK}
            emojiStyle={EmojiStyle.NATIVE}
            skinTonesDisabled
            searchPlaceHolder="Search"
            width={320}
            height={360}
            previewConfig={{ showPreview: false }}
            onEmojiClick={(e) => {
              onChange(e.emoji);
              setOpen(false);
            }}
          />
          {value ? (
            <div className="flex justify-end border-t border-border-1 p-2">
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="rounded px-2 py-1 text-[11px] text-text-3 hover:text-destructive"
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
