/**
 * A panel that is DRAGGED out from the right by its tab (Graeme, 2026-10-09;
 * Objective F). The rules — follow the finger, snap at a third, a flick
 * wins, a tap still opens — are pure and tested in lib/swipe-snap.ts.
 *
 *   - The drag only ever starts ON THE TAB (or, to close, on the open
 *     panel): never on the bare screen edge, which Safari keeps for
 *     back/forward.
 *   - Pointer events, so it works the same with a finger, a pen or a mouse.
 *   - While it is out the page behind is dimmed and can't be used; it
 *     closes by swiping right, the X, tapping the dimmed strip, or Escape.
 *   - Respects "reduce motion": it moves without the slide.
 *
 * About 85% of the screen on an iPad, the full width on a phone (there the
 * X and a swipe close it). Below every modal (z-150) — choosing an action
 * shuts the panel, then the action's own modal opens.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dragProgress, isTap, panelWidth, releaseVelocity, snapAfterDrag } from "@/lib/swipe-snap";

export type PanelChange = "drag" | "tap" | "close" | "backdrop" | "escape" | "action";

const TAB_WIDTH = 44;

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1080 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  startProgress: number;
  wasOpen: boolean;
  samples: Array<{ x: number; t: number }>;
  /** For drags that start on the panel body: decided once it moves. */
  axis: "pending" | "x" | "y";
  fromTab: boolean;
}

export function SwipePanel({ open, onOpenChange, title, tab, tabLabel, highlightTab = false, children }: {
  open: boolean;
  onOpenChange: (open: boolean, via: PanelChange) => void;
  title: string;
  /** What the tab shows (dots, a count…). */
  tab: ReactNode;
  tabLabel: string;
  /** Pulse the tab (the walkthrough's "try it now"). */
  highlightTab?: boolean;
  children: ReactNode;
}) {
  const vw = useViewportWidth();
  const width = panelWidth(vw);
  const reduced = usePrefersReducedMotion();
  const [live, setLive] = useState<number | null>(null); // progress while dragging
  const drag = useRef<Drag | null>(null);
  const progress = live ?? (open ? 1 : 0);

  // Escape closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false, "escape"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const begin = useCallback((e: ReactPointerEvent<HTMLElement>, fromTab: boolean) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    drag.current = {
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startProgress: open ? 1 : 0, wasOpen: open,
      samples: [{ x: e.clientX, t: e.timeStamp }], axis: fromTab ? "x" : "pending", fromTab,
    };
    if (fromTab) {
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }, [open]);

  const move = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.axis === "pending") {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      // On the panel body only a sideways swipe drags; up/down scrolls.
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "x") e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (d.axis !== "x") return;
    d.samples.push({ x: e.clientX, t: e.timeStamp });
    if (d.samples.length > 12) d.samples.shift();
    if (!isTap(dx) || live !== null) setLive(dragProgress(d.startProgress, dx, width));
  }, [width, live]);

  const end = useCallback((e: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    const dx = e.clientX - d.startX;
    const moved = d.axis === "x" && !isTap(dx);
    setLive(null);
    if (cancelled) return;
    if (!moved) {
      // A tap on the tab toggles it (the fallback for anyone who taps).
      if (d.fromTab) onOpenChange(!d.wasOpen, "tap");
      return;
    }
    const result = snapAfterDrag({
      wasOpen: d.wasOpen,
      progress: dragProgress(d.startProgress, dx, width),
      velocityPxPerMs: releaseVelocity([...d.samples, { x: e.clientX, t: e.timeStamp }]),
    });
    const next = result === "open";
    if (next !== d.wasOpen) onOpenChange(next, "drag");
  }, [onOpenChange, width]);

  const animate = live === null && !reduced;
  const translate = (1 - progress) * width;

  return createPortal(
    <>
      {/* The dimmed page behind: blocks the page and closes on a tap. */}
      {progress > 0 && (
        <div
          className="fixed inset-0 z-[90] bg-black"
          style={{ opacity: 0.5 * progress, transition: animate ? "opacity 220ms ease-out" : undefined }}
          onClick={() => onOpenChange(false, "backdrop")}
          aria-hidden="true"
        />
      )}
      <div
        className="fixed top-0 bottom-0 right-0 z-[95]"
        style={{
          width,
          transform: `translateX(${translate}px)`,
          transition: animate ? "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
        }}
      >
        {/* The tab, stuck to the panel's left edge: grab it and drag left. */}
        <button
          type="button"
          aria-label={tabLabel}
          aria-expanded={open}
          title={tabLabel}
          onPointerDown={e => begin(e, true)}
          onPointerMove={move}
          onPointerUp={e => end(e)}
          onPointerCancel={e => end(e, true)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenChange(!open, "tap"); } }}
          className={cn(
            "absolute top-[38%] h-24 rounded-l-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/30",
            "flex flex-col items-center justify-center gap-1.5 select-none touch-none cursor-grab active:cursor-grabbing",
            highlightTab && !open && "swipe-tab-pulse",
          )}
          style={{ left: -TAB_WIDTH, width: TAB_WIDTH }}
        >
          {tab}
        </button>

        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          inert={!open && live === null}
          onPointerDown={e => { if (open) begin(e, false); }}
          onPointerMove={move}
          onPointerUp={e => end(e)}
          onPointerCancel={e => end(e, true)}
          className="h-full bg-background border-l border-border shadow-2xl flex flex-col"
          style={{ touchAction: "pan-y" }}
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3 border-b border-border">
            <h2 className="text-2xl font-bold">{title}</h2>
            <button
              type="button"
              onClick={() => onOpenChange(false, "close")}
              className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center flex-shrink-0"
              aria-label="Close"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
          <p className="px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-sm text-muted-foreground text-center">
            Swipe right to put it away
          </p>
        </div>
      </div>
    </>,
    document.body,
  );
}
