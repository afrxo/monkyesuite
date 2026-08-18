// Shared date selector — the calendar popover used by the card panel (task due
// date) and the milestone target date. Extracted from CardModal so both
// surfaces use one control. Value is a UTC-midnight ISO string or null.

import { useState } from "react";
import { Icon } from "../components/Icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import { relTime } from "../lib/format";

export function DatePicker({
  value,
  onChange,
  title = "Due date",
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value) : null;
  const label = selected
    ? `${pad2(selected.getUTCDate())}.${pad2(selected.getUTCMonth() + 1)}.${selected.getUTCFullYear()}`
    : "dd.mm.yyyy";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-text-3 hover:bg-surface-hover"
        >
          <Icon name="clock" size={11} className="text-text-disabled" />
          <span
            className={`font-mono text-[11px] ${selected ? "text-text-1" : "text-text-disabled"}`}
          >
            {label}
          </span>
          {selected ? (
            <span className="font-mono text-[10px] text-text-disabled">
              · {relTime(value ?? "")}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[260px] overflow-hidden rounded-md border border-border-1 bg-surface-1 p-2 text-text-1 shadow-xl"
      >
        <Calendar
          selected={selected}
          onSelect={(d) => {
            onChange(
              new Date(
                Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()),
              ).toISOString(),
            );
            setOpen(false);
          }}
          onClear={() => {
            onChange(null);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

const MONTH_LABEL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DOW = [
  { k: "mon", l: "M" },
  { k: "tue", l: "T" },
  { k: "wed", l: "W" },
  { k: "thu", l: "T" },
  { k: "fri", l: "F" },
  { k: "sat", l: "S" },
  { k: "sun", l: "S" },
];

function Calendar({
  selected,
  onSelect,
  onClear,
}: {
  selected: Date | null;
  onSelect: (d: Date) => void;
  onClear: () => void;
}) {
  const today = new Date();
  const initial = selected ?? today;
  const [view, setView] = useState({
    y: initial.getUTCFullYear(),
    m: initial.getUTCMonth(),
  });
  const firstOfMonth = new Date(view.y, view.m, 1);
  // Monday-first offset: JS getDay() has Sun=0; shift so Mon=0.
  const startDow = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: { d: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < startDow; i++) {
    const d = new Date(view.y, view.m, -startDow + i + 1);
    cells.push({ d, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ d: new Date(view.y, view.m, d), inMonth: true });
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const last = cells[cells.length - 1];
    if (!last) break;
    const next = new Date(
      last.d.getFullYear(),
      last.d.getMonth(),
      last.d.getDate() + 1,
    );
    cells.push({ d: next, inMonth: next.getMonth() === view.m });
    if (cells.length >= 42) break;
  }
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const nudge = (delta: number) => {
    setView((v) => {
      const m = v.m + delta;
      const y = v.y + Math.floor(m / 12);
      return { y, m: ((m % 12) + 12) % 12 };
    });
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[12px] font-semibold text-text-1">
          {MONTH_LABEL[view.m]} {view.y}
        </span>
        <div className="flex gap-0.5">
          <button
            type="button"
            onClick={() => nudge(-1)}
            aria-label="Previous month"
            className="grid h-5 w-5 place-items-center rounded text-text-disabled hover:bg-surface-hover hover:text-text-1"
          >
            <Icon name="chevron-down" size={10} className="rotate-90" />
          </button>
          <button
            type="button"
            onClick={() => nudge(1)}
            aria-label="Next month"
            className="grid h-5 w-5 place-items-center rounded text-text-disabled hover:bg-surface-hover hover:text-text-1"
          >
            <Icon name="chevron-down" size={10} className="-rotate-90" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px pb-1">
        {DOW.map((d) => (
          <div
            key={d.k}
            className="pb-1 text-center font-mono text-[9px] uppercase text-text-disabled"
          >
            {d.l}
          </div>
        ))}
        {cells.map(({ d, inMonth }) => {
          const isSel = selected ? sameDay(d, selected) : false;
          const isToday = sameDay(d, today);
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onSelect(d)}
              className={`grid h-7 w-7 place-items-center rounded font-mono text-[11px] transition-colors ${
                isSel
                  ? "bg-accent-warm text-[#1a1000]"
                  : inMonth
                    ? isToday
                      ? "bg-surface-hover text-text-1"
                      : "text-text-2 hover:bg-surface-hover"
                    : "text-text-disabled hover:bg-surface-hover"
              }`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-border-1 pt-1.5">
        <button
          type="button"
          onClick={onClear}
          className="rounded px-1.5 py-0.5 text-[11px] text-text-disabled hover:bg-surface-hover hover:text-text-3"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => onSelect(new Date())}
          className="rounded px-1.5 py-0.5 text-[11px] text-text-3 hover:bg-surface-hover hover:text-text-1"
        >
          Today
        </button>
      </div>
    </div>
  );
}
