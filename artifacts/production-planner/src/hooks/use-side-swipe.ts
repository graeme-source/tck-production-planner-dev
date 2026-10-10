/**
 * One sideways-swipe engine for the whole app (Graeme, 2026-10-10;
 * Objectives F and H): the quick-actions panel (open from anywhere on the
 * right, drag the open panel away — even starting on a button) and the
 * founder's left swipe to The Business. The rules are pure, in
 * lib/edge-swipe.ts and lib/swipe-snap.ts; this file is only the DOM
 * wiring.
 *
 * Why TOUCH events for fingers rather than pointer events: on an iPad the
 * browser takes over a sideways pan inside a scrolling area and sends
 * pointercancel, which is exactly why the panel couldn't be swiped away
 * from on top of its buttons. Touch events keep coming, and once a gesture
 * is clearly ours we preventDefault the moves so nothing scrolls under it.
 * A mouse uses pointer events. Listeners sit on window in the capture
 * phase, so nothing inside the page can swallow them.
 *
 * Once a drag is recognised, the click that would follow on the element the
 * finger started on (a button, a card) is swallowed; a tap — no real
 * movement — still clicks as normal.
 */
import { useEffect, useRef } from "react";
import { classifyMove, type AncestorInfo } from "@/lib/edge-swipe";
import { releaseVelocity } from "@/lib/swipe-snap";

export interface SwipeConfig {
  /** -1 = right-to-left only, +1 = left-to-right only, 0 = either. */
  direction: -1 | 0 | 1;
  slopPx?: number;
  ratio?: number;
}

export interface SideSwipeHandlers {
  /** Finger (or mouse button) down: watch this gesture? null = ignore it. */
  begin: (p: { x: number; y: number; target: Element; kind: "touch" | "mouse" }) => SwipeConfig | null;
  /** Called on every move once the gesture is recognised; dx from the start. */
  onDrag: (dx: number) => void;
  onRelease: (dx: number, velocityPxPerMs: number) => void;
  /** The system took the touch away (a call, a second finger…). */
  onCancel: () => void;
}

interface Tracking {
  id: number; // touch identifier, or -1 for the mouse
  x0: number;
  y0: number;
  cfg: SwipeConfig;
  recognised: boolean;
  samples: Array<{ x: number; t: number }>;
}

/** Clicks swallowed until this time (performance.now()), shared by every swipe. */
let suppressClicksUntil = 0;
let clickGuardInstalled = false;
function installClickGuard() {
  if (clickGuardInstalled || typeof window === "undefined") return;
  clickGuardInstalled = true;
  window.addEventListener("click", e => {
    if (performance.now() < suppressClicksUntil) {
      e.preventDefault();
      e.stopPropagation();
      suppressClicksUntil = 0;
    }
  }, true);
}

/** The chain of elements from the touched one up to <body>, for blockedByAncestors. */
export function ancestorChain(target: Element | null): AncestorInfo[] {
  const out: AncestorInfo[] = [];
  let el: Element | null = target;
  while (el && el !== document.body && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    out.push({
      tag: el.tagName,
      attrs: {
        "data-no-swipe": el.getAttribute("data-no-swipe"),
        contenteditable: el.getAttribute("contenteditable"),
        draggable: el.getAttribute("draggable"),
        role: el.getAttribute("role"),
        "aria-roledescription": el.getAttribute("aria-roledescription"),
      },
      overflowX: cs.overflowX,
      sidewaysSlackPx: el.scrollWidth - el.clientWidth,
    });
    el = el.parentElement;
  }
  return out;
}

export function useSideSwipe(handlers: SideSwipeHandlers, enabled: boolean): void {
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    installClickGuard();
    let tr: Tracking | null = null;
    let restoreSelect: string | null = null;

    const start = (id: number, x: number, y: number, target: EventTarget | null, kind: "touch" | "mouse", t: number) => {
      if (!(target instanceof Element)) return;
      const cfg = h.current.begin({ x, y, target, kind });
      if (!cfg) return;
      tr = { id, x0: x, y0: y, cfg, recognised: false, samples: [{ x, t }] };
    };
    // Returns true if the move belongs to us (caller then preventDefaults).
    const move = (x: number, y: number, t: number): boolean => {
      if (!tr) return false;
      const dx = x - tr.x0;
      const dy = y - tr.y0;
      if (!tr.recognised) {
        const v = classifyMove({ dx, dy, direction: tr.cfg.direction, slopPx: tr.cfg.slopPx, ratio: tr.cfg.ratio });
        if (v === "pending") return false;
        if (v === "abandon") { tr = null; return false; }
        tr.recognised = true;
        if (tr.id === -1) {
          restoreSelect = document.body.style.userSelect;
          document.body.style.userSelect = "none";
          window.getSelection()?.removeAllRanges();
        }
      }
      tr.samples.push({ x, t });
      if (tr.samples.length > 12) tr.samples.shift();
      h.current.onDrag(dx);
      return true;
    };
    const finish = (x: number, t: number, cancelled: boolean) => {
      const cur = tr;
      tr = null;
      if (!cur || !cur.recognised) return;
      if (restoreSelect !== null) { document.body.style.userSelect = restoreSelect; restoreSelect = null; }
      // It was a drag, not a tap: the click that follows mustn't press the
      // button the finger started on.
      suppressClicksUntil = performance.now() + 400;
      if (cancelled) { h.current.onCancel(); return; }
      h.current.onRelease(x - cur.x0, releaseVelocity([...cur.samples, { x, t }]));
    };

    const findTouch = (list: TouchList, id: number) => {
      for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
      return null;
    };
    const onTouchStart = (e: TouchEvent) => {
      if (tr) {
        // A second finger: not a swipe any more.
        if (tr.recognised) finish(tr.x0, e.timeStamp, true); else tr = null;
        return;
      }
      if (e.touches.length !== 1) return;
      const t0 = e.touches[0];
      start(t0.identifier, t0.clientX, t0.clientY, e.target, "touch", e.timeStamp);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!tr || tr.id === -1) return;
      const t0 = findTouch(e.changedTouches, tr.id);
      if (!t0) return;
      if (move(t0.clientX, t0.clientY, e.timeStamp) && e.cancelable) e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!tr || tr.id === -1) return;
      const t0 = findTouch(e.changedTouches, tr.id);
      if (!t0) return;
      finish(t0.clientX, e.timeStamp, e.type === "touchcancel");
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || tr) return;
      start(-1, e.clientX, e.clientY, e.target, "mouse", e.timeStamp);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !tr || tr.id !== -1) return;
      move(e.clientX, e.clientY, e.timeStamp);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !tr || tr.id !== -1) return;
      finish(e.clientX, e.timeStamp, e.type === "pointercancel");
    };

    const opts: AddEventListenerOptions = { capture: true, passive: false };
    window.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    window.addEventListener("touchmove", onTouchMove, opts);
    window.addEventListener("touchend", onTouchEnd, true);
    window.addEventListener("touchcancel", onTouchEnd, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    return () => {
      window.removeEventListener("touchstart", onTouchStart, true);
      window.removeEventListener("touchmove", onTouchMove, true);
      window.removeEventListener("touchend", onTouchEnd, true);
      window.removeEventListener("touchcancel", onTouchEnd, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      if (restoreSelect !== null) document.body.style.userSelect = restoreSelect;
    };
  }, [enabled]);
}
