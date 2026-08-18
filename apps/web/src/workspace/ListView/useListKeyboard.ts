// Roving-tabindex keyboard nav for the List table. The table is one tab stop;
// arrows (and j/k) move focus over the *visible* flat row list (collapsed groups
// and collapsed subtasks are already excluded by the caller). Enter opens the
// focused row's card; →/← expand/collapse the focused parent. Focus is restored
// to the remembered row when the card modal closes.

import { useCallback, useEffect, useRef, useState } from "react";

export type FlatRow = {
  key: string; // stable per task (taskId)
  taskId: string;
  isParent: boolean;
  hasSubtasks: boolean;
  expanded: boolean;
};

type Args = {
  rows: FlatRow[];
  openCardTaskId: string | null; // from URL ?card — null when modal closed
  onOpen: (taskId: string) => void;
  onExpand: (taskId: string, next: boolean) => void;
};

export function useListKeyboard({ rows, openCardTaskId, onOpen, onExpand }: Args) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const elems = useRef(new Map<string, HTMLElement>());
  const rememberedKey = useRef<string | null>(null);

  const registerRow = useCallback((key: string, el: HTMLElement | null) => {
    if (el) elems.current.set(key, el);
    else elems.current.delete(key);
  }, []);

  const focusRow = useCallback((key: string) => {
    setFocusedKey(key);
    rememberedKey.current = key;
    // Focus after paint so a freshly-rendered row (e.g. after expand) exists.
    requestAnimationFrame(() => elems.current.get(key)?.focus());
  }, []);

  const move = useCallback(
    (delta: 1 | -1) => {
      if (rows.length === 0) return;
      const idx = focusedKey
        ? rows.findIndex((r) => r.key === focusedKey)
        : -1;
      const next =
        idx === -1
          ? delta === 1
            ? 0
            : rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, idx + delta));
      const target = rows[next];
      if (target) focusRow(target.key);
    },
    [rows, focusedKey, focusRow],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          move(1);
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          move(-1);
          break;
        case "Enter": {
          if (!focusedKey) break;
          const row = rows.find((r) => r.key === focusedKey);
          if (row) {
            e.preventDefault();
            onOpen(row.taskId);
          }
          break;
        }
        case "ArrowRight": {
          const row = rows.find((r) => r.key === focusedKey);
          if (row?.isParent && row.hasSubtasks && !row.expanded) {
            e.preventDefault();
            onExpand(row.taskId, true);
          }
          break;
        }
        case "ArrowLeft": {
          const row = rows.find((r) => r.key === focusedKey);
          if (row?.isParent && row.hasSubtasks && row.expanded) {
            e.preventDefault();
            onExpand(row.taskId, false);
          }
          break;
        }
      }
    },
    [rows, focusedKey, move, onOpen, onExpand],
  );

  // Restore focus to the remembered row when the modal closes.
  const prevOpen = useRef<string | null>(openCardTaskId);
  useEffect(() => {
    if (prevOpen.current && !openCardTaskId && rememberedKey.current) {
      const key = rememberedKey.current;
      requestAnimationFrame(() => elems.current.get(key)?.focus());
    }
    prevOpen.current = openCardTaskId;
  }, [openCardTaskId]);

  return { focusedKey, registerRow, focusRow, onKeyDown };
}
