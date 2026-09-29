/**
 * Drag an event bar to move it, or drag one of its ends to stretch/shrink it.
 * Pointer events, so it works the same with a finger on the iPad, a pencil or
 * a mouse. Both views give it one question to answer — "which day is under
 * this point?" — and the day maths comes from @workspace/marketing-calendar.
 *
 * A press that barely moves is a tap (opens the event), not a drag.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { applyDrag, daysBetween, type DragMode } from "@workspace/marketing-calendar";

export interface DragSpan { id: number; startDate: string; endDate: string }

interface Options<T extends DragSpan> {
  /** The ISO day under a screen point, or null when off the calendar. */
  dateAt: (clientX: number, clientY: number) => string | null;
  onCommit: (event: T, next: { startDate: string; endDate: string }, mode: DragMode) => void;
  onTap: (event: T) => void;
}

const TAP_SLOP_PX = 6;

export function useSpanDrag<T extends DragSpan>({ dateAt, onCommit, onTap }: Options<T>) {
  const [preview, setPreview] = useState<{ id: number; startDate: string; endDate: string; mode: DragMode } | null>(null);
  const drag = useRef<{
    event: T; mode: DragMode; grabDate: string; x: number; y: number; moved: boolean; pointerId: number;
    latest: { startDate: string; endDate: string };
  } | null>(null);
  const lastDragEnd = useRef(0);
  const opts = useRef({ dateAt, onCommit, onTap });
  opts.current = { dateAt, onCommit, onTap };

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < TAP_SLOP_PX) return;
    d.moved = true;
    e.preventDefault();
    const over = opts.current.dateAt(e.clientX, e.clientY);
    if (!over) return;
    const next = applyDrag(d.event, d.mode, daysBetween(d.grabDate, over));
    d.latest = next;
    setPreview({ id: d.event.id, ...next, mode: d.mode });
  }, []);

  const finish = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    setPreview(null);
    if (e.type === "pointercancel") return;
    if (!d.moved) { opts.current.onTap(d.event); return; }
    lastDragEnd.current = Date.now();
    if (d.latest.startDate !== d.event.startDate || d.latest.endDate !== d.event.endDate) {
      opts.current.onCommit(d.event, d.latest, d.mode);
    }
  }, [onMove]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
  }, [onMove, finish]);

  const start = useCallback((e: React.PointerEvent, event: T, mode: DragMode) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const grabDate = opts.current.dateAt(e.clientX, e.clientY);
    if (!grabDate) return;
    e.stopPropagation();
    drag.current = {
      event, mode, grabDate, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId,
      latest: { startDate: event.startDate, endDate: event.endDate },
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [onMove, finish]);

  /** The span to draw for an event — its dragged position while dragging. */
  const spanOf = useCallback(<S extends DragSpan>(ev: S): S =>
    (preview && preview.id === ev.id ? { ...ev, startDate: preview.startDate, endDate: preview.endDate } : ev), [preview]);

  /** True just after a drag ends — the browser's follow-up click must not
   *  count as "tap an empty day". */
  const justDragged = useCallback(() => Date.now() - lastDragEnd.current < 400, []);

  return { start, preview, spanOf, dragging: preview != null, justDragged };
}

/** Find the calendar day under a point via the data-cal-date attribute. */
export function dateFromElementsAt(clientX: number, clientY: number): string | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const d = (el as HTMLElement).dataset?.["calDate"];
    if (d) return d;
  }
  return null;
}
