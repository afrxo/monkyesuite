// One pointer-drag controller for every timeline gesture: bar move, edge
// resize, marker move, milestone diamond move, tray-chip scheduling. Pointer
// capture + document listeners; 4px threshold before a gesture starts (so a
// sloppy click still opens the card); Esc cancels and restores; snap is to
// whole days always — the data has no sub-day precision.
//
// During a drag only `dayDelta` / `targetGroupKey` state changes — the bar
// mutates a transform, nothing else. Geometry commits on drop.

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { DRAG_THRESHOLD } from "./geometry";

export type DragSpec =
  | {
      kind: "move" | "marker";
      taskId: string;
      startDay: number | null;
      dueDay: number;
      groupKey: string;
    }
  | {
      kind: "resize-start" | "resize-due";
      taskId: string;
      startDay: number;
      dueDay: number;
      groupKey: string;
    }
  | { kind: "diamond"; milestoneId: string; targetDay: number }
  | { kind: "tray"; taskId: string; title: string; colorHex: string };

export type DragLive = {
  spec: DragSpec;
  /** true once the pointer moved past the 4px threshold */
  engaged: boolean;
  dayDelta: number;
  /** group row currently under the pointer (vertical reassign / tray drop) */
  targetGroupKey: string | null;
  /** day under the pointer within the hovered lane (tray drops) */
  pointerDay: number | null;
  pointerX: number;
  pointerY: number;
};

export type DragCommit = {
  spec: DragSpec;
  dayDelta: number;
  targetGroupKey: string | null;
  pointerDay: number | null;
};

export function useTimelineDrag({
  dayWidth,
  originDay,
  onCommit,
}: {
  dayWidth: number;
  originDay: number;
  onCommit: (c: DragCommit) => void;
}) {
  const [live, setLive] = useState<DragLive | null>(null);
  // True for one tick after an engaged drag ends, so the click that follows
  // pointerup doesn't also open the card.
  const justDragged = useRef(false);
  const ref = useRef<{
    spec: DragSpec;
    startX: number;
    startY: number;
    engaged: boolean;
    dayDelta: number;
    targetGroupKey: string | null;
    pointerDay: number | null;
  } | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const stop = useCallback((commit: boolean) => {
    const d = ref.current;
    ref.current = null;
    setLive(null);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    if (d?.engaged) {
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      if (commit) {
        onCommitRef.current({
          spec: d.spec,
          dayDelta: d.dayDelta,
          targetGroupKey: d.targetGroupKey,
          pointerDay: d.pointerDay,
        });
      }
    }
  }, []);

  const dragging = live !== null;
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = ref.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (
        !d.engaged &&
        Math.abs(dx) < DRAG_THRESHOLD &&
        Math.abs(dy) < DRAG_THRESHOLD
      )
        return;
      d.engaged = true;
      d.dayDelta = Math.round(dx / dayWidth);

      // Row under the pointer: vertical milestone reassign + tray drops.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const lane = el?.closest("[data-tl-lane]");
      if (lane instanceof HTMLElement) {
        d.targetGroupKey = lane.dataset.tlGroup ?? null;
        const rect = lane.getBoundingClientRect();
        d.pointerDay =
          originDay + Math.floor((e.clientX - rect.left) / dayWidth);
      } else {
        d.targetGroupKey = null;
        d.pointerDay = null;
      }
      setLive({
        spec: d.spec,
        engaged: true,
        dayDelta: d.dayDelta,
        targetGroupKey: d.targetGroupKey,
        pointerDay: d.pointerDay,
        pointerX: e.clientX,
        pointerY: e.clientY,
      });
    };
    const onUp = () => stop(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [dragging, dayWidth, originDay, stop]);

  const startDrag = useCallback((e: ReactPointerEvent, spec: DragSpec) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    ref.current = {
      spec,
      startX: e.clientX,
      startY: e.clientY,
      engaged: false,
      dayDelta: 0,
      targetGroupKey: null,
      pointerDay: null,
    };
    document.body.style.userSelect = "none";
    setLive({
      spec,
      engaged: false,
      dayDelta: 0,
      targetGroupKey: null,
      pointerDay: null,
      pointerX: e.clientX,
      pointerY: e.clientY,
    });
  }, []);

  return { live, startDrag, justDragged };
}
