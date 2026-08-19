// Month-grain sibling of the shared DatePicker (workspace/DatePicker.tsx —
// the card panel's due-date control). Same popover chrome, trigger style and
// nav-arrow affordance, but a 12-month grid instead of a day grid since
// revenue rows are logged per calendar month (spec §7.4).

import { useState } from "react";
import { Icon } from "../../components/Icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parse(month: string): { y: number; m: number } {
  const [y, m] = month.split("-").map(Number);
  return { y: y ?? 2026, m: (m ?? 1) - 1 };
}

function format(y: number, m: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function FinanceMonthPicker({
  value,
  onChange,
  title = "Month",
}: {
  value: string; // YYYY-MM
  onChange: (month: string) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const { y: selY, m: selM } = parse(value);
  const [viewY, setViewY] = useState(selY);
  const label = `${MONTH_SHORT[selM]} ${selY}`;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setViewY(selY);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-text-3 hover:bg-surface-hover"
        >
          <Icon name="clock" size={11} className="text-text-disabled" />
          <span className="font-mono text-[11px] text-text-1">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[220px] overflow-hidden rounded-md border border-border-1 bg-surface-1 p-2 text-text-1 shadow-xl"
      >
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[12px] font-semibold text-text-1">{viewY}</span>
          <div className="flex gap-0.5">
            <button
              type="button"
              onClick={() => setViewY((y) => y - 1)}
              aria-label="Previous year"
              className="grid h-5 w-5 place-items-center rounded text-text-disabled hover:bg-surface-hover hover:text-text-1"
            >
              <Icon name="chevron-down" size={10} className="rotate-90" />
            </button>
            <button
              type="button"
              onClick={() => setViewY((y) => y + 1)}
              aria-label="Next year"
              className="grid h-5 w-5 place-items-center rounded text-text-disabled hover:bg-surface-hover hover:text-text-1"
            >
              <Icon name="chevron-down" size={10} className="-rotate-90" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {MONTH_SHORT.map((label, i) => {
            const isSel = viewY === selY && i === selM;
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  onChange(format(viewY, i));
                  setOpen(false);
                }}
                className={`grid h-8 place-items-center rounded font-mono text-[11px] transition-colors ${
                  isSel
                    ? "bg-accent-warm text-[#1a1000]"
                    : "text-text-2 hover:bg-surface-hover"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex items-center justify-end border-t border-border-1 pt-1.5">
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              onChange(format(now.getUTCFullYear(), now.getUTCMonth()));
              setOpen(false);
            }}
            className="rounded px-1.5 py-0.5 text-[11px] text-text-3 hover:bg-surface-hover hover:text-text-1"
          >
            This month
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
