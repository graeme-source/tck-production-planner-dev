/**
 * A panel that is SWIPED out from the right (Graeme, 2026-10-09, reworked
 * 2026-10-10; Objective F).
 *
 *   - OPEN: swipe right-to-left starting anywhere in the right half of the
 *     screen, any height — like the iPhone's notification centre — or drag
 *     / tap the slim handle on the right edge. The panel follows the finger.
 *     Guard rails (pure, tested in lib/edge-swipe.ts): clearly sideways,
 *     24 px before anything moves, never the last 20 px of the edge
 *     (Safari's forward swipe), never from a text box, slider, map,
 *     drag-and-drop area, sideways-scrolling table or data-no-swipe, never
 *     over another pop-up or the PIN lock (the caller says, via
 *     `edgeSwipeEnabled`).
 *   - CLOSE: a LONG swipe back to the right — it works starting on top of
 *     the panel's buttons and cards (the button doesn't fire), and needs the
 *     panel pushed half way back (or a real flick that's gone 30%);
 *     otherwise it springs back open. Also the X, tapping the dimmed strip,
 *     or Escape. Rules: lib/swipe-snap.ts.
 *   - Up/down still scrolls the panel's content.
 *   - Respects "reduce motion": it moves without the slide.
 *
 *   - WITH A MOUSE OR TRACKPAD (2026-10-13): a big green "Quick actions"
 *     tab replaces the slim handle — click to open, click again (or Esc,
 *     or the dimmed strip) to close. Touchscreen laptops get the tab AND
 *     keep the swipe. Rule: quickActionsHandleStyle in lib/edge-swipe.ts.
 *
 * About 85% of the screen on an iPad, the full width on a phone. Shut, the
 * handle sits below every pop-up and hides while one is up; choosing an
 * action shuts the panel, then the action's own modal opens.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dragProgress, panelWidth, snapAfterDrag, PANEL_DRAG_SLOP_PX, TAP_SLOP_PX } from "@/lib/swipe-snap";
import { blockedByAncestors, inStartZone, quickActionsHandleStyle, quickActionsHandleVisible } from "@/lib/edge-swipe";
import { fullScreenOverlayShowing, useFullScreenOverlayShowing } from "@/lib/prompt-presence";
import { ancestorChain, useSideSwipe } from "@/hooks/use-side-swipe";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { usePointerKind } from "@/hooks/use-touch-primary";

export type PanelChange = "drag" | "tap" | "close" | "backdrop" | "escape" | "action";

/** The invisible area round the slim handle that a finger can hit. */
const HANDLE_HIT_WIDTH = 32;
/** The visible handle: a slim strip with three dots. */
const HANDLE_WIDTH = 10;
/** The mouse/trackpad tab: 44 px wide (w-11), this tall. */
const TAB_HEIGHT = 128;

function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1080 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

export function SwipePanel({ open, onOpenChange, title, badge, tabLabel, highlightTab = false, edgeSwipeEnabled = true, children }: {
  open: boolean;
  onOpenChange: (open: boolean, via: PanelChange) => void;
  title: string;
  /** A small count on the handle (open to-dos…); 0/undefined = none. */
  badge?: number;
  tabLabel: string;
  /** Pulse the handle (the walkthrough's "try it now"). */
  highlightTab?: boolean;
  /** False while another pop-up or the PIN lock is up: no swipe-open. */
  edgeSwipeEnabled?: boolean;
  children: ReactNode;
}) {
  const vw = useViewportWidth();
  const width = panelWidth(vw);
  const reduced = usePrefersReducedMotion();
  const [live, setLive] = useState<number | null>(null); // progress while dragging
  const dialogRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const startProgress = useRef(0);
  const progress = live ?? (open ? 1 : 0);
  const handleStyle = quickActionsHandleStyle(usePointerKind());
  // Another pop-up up while the panel's shut: no handle at all.
  const overlayShowing = useFullScreenOverlayShowing(progress === 0);
  const handleVisible = quickActionsHandleVisible({ style: handleStyle, progress, overlayShowing });

  // Escape closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false, "escape"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useSideSwipe({
    begin: ({ x, target }) => {
      if (live !== null) return null;
      if (open) {
        // Dragging the open panel away — from anywhere on it, buttons
        // included. Small slop so it picks up quickly; mostly-sideways.
        if (!dialogRef.current?.contains(target)) return null;
        if (blockedByAncestors(ancestorChain(target))) return null;
        startProgress.current = 1;
        return { direction: 0, slopPx: PANEL_DRAG_SLOP_PX, ratio: 1 };
      }
      // Shut: the handle itself (a short slop, it's an obvious grab)…
      if (handleRef.current?.contains(target)) {
        startProgress.current = 0;
        return { direction: -1, slopPx: TAP_SLOP_PX, ratio: 1 };
      }
      // …or anywhere in the right half, with every guard rail.
      if (!edgeSwipeEnabled) return null;
      if (!inStartZone("right", x, window.innerWidth)) return null;
      if (blockedByAncestors(ancestorChain(target))) return null;
      if (document.querySelector("[data-side-swipe-busy]") || fullScreenOverlayShowing()) return null;
      startProgress.current = 0;
      return { direction: -1 };
    },
    onDrag: dx => setLive(dragProgress(startProgress.current, dx, width)),
    onRelease: (dx, velocity) => {
      const wasOpen = startProgress.current === 1;
      setLive(null);
      const result = snapAfterDrag({ wasOpen, progress: dragProgress(startProgress.current, dx, width), velocityPxPerMs: velocity });
      const next = result === "open";
      if (next !== wasOpen) onOpenChange(next, "drag");
    },
    onCancel: () => setLive(null),
  }, true);

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
        // Shut, it sits BELOW every pop-up (they start at z-50), so a modal's
        // backdrop and pinned save bar always cover the handle; out, or
        // moving, it rises above its own dimmed backdrop (z-90).
        className={cn("fixed top-0 bottom-0 right-0", progress > 0 ? "z-[95]" : "z-[40]")}
        // While it's out (or moving), the founder's left swipe stays off.
        data-side-swipe-busy={progress > 0 ? "" : undefined}
        style={{
          width,
          transform: `translateX(${translate}px)`,
          transition: animate ? "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
        }}
      >
        {/* With a mouse or trackpad: a big green "Quick actions" tab on the
            right edge (Graeme, 2026-10-13: the slim strip was "a tiny button,
            hard to click"). It rides on the panel's edge, so a second click
            puts the panel away. */}
        {handleStyle === "tab" && handleVisible && (
          <button
            ref={handleRef}
            type="button"
            aria-label={open ? `Close ${title.toLowerCase()}` : tabLabel}
            aria-expanded={open}
            title={open ? `Close ${title.toLowerCase()}` : title}
            onClick={() => onOpenChange(!open, "tap")}
            className={cn(
              "group absolute top-1/2 -translate-y-1/2 flex flex-col items-center justify-center gap-2 py-3 select-none cursor-pointer",
              "rounded-l-2xl bg-primary text-primary-foreground shadow-lg shadow-black/20 border border-r-0 border-primary",
              "transition-[width,background-color] duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
              highlightTab && !open && "swipe-tab-pulse",
            )}
            // Shut, it sits left of the team list dock when that's open.
            style={{ right: open ? "100%" : "calc(100% + var(--team-dock-w, 0px))", height: TAB_HEIGHT }}
            data-testid="quick-actions-handle"
            data-handle-style="tab"
          >
            {/* 44 px wide; grows a little leftwards on hover, so it reads as clickable. */}
            <span aria-hidden="true" className={cn("flex flex-col items-center gap-2 w-11 transition-[width] duration-150", !open && "group-hover:w-[52px]")}>
              {open ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
              <span className="text-xs font-bold tracking-wide whitespace-nowrap" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                {title}
              </span>
            </span>
            {badge != null && badge > 0 && !open && (
              <span className="absolute -top-2 -left-2 min-w-[20px] h-5 px-1 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center tabular-nums shadow">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </button>
        )}

        {/* On a touch screen: a slim strip with three coloured dots on the
            right edge — just a reminder the quick actions are there (the
            whole right half swipes). The button round it is wider than it
            looks, so it's easy to tap open. Hidden while the panel is out
            (the X and a swipe close it). */}
        {handleStyle === "slim" && handleVisible && (
          <button
            ref={handleRef}
            type="button"
            aria-label={tabLabel}
            aria-expanded={open}
            title={tabLabel}
            onClick={() => onOpenChange(!open, "tap")}
            className="absolute top-1/2 -translate-y-1/2 h-24 flex items-center justify-end select-none cursor-pointer"
            style={{ left: `calc(-${HANDLE_HIT_WIDTH}px - var(--team-dock-w, 0px))`, width: HANDLE_HIT_WIDTH, touchAction: "none" }}
            data-testid="quick-actions-handle"
            data-handle-style="slim"
          >
            <span
              className={cn(
                "relative h-14 rounded-l-full bg-card border border-r-0 border-border shadow-md flex flex-col items-center justify-center gap-1",
                highlightTab && !open && "swipe-tab-pulse",
              )}
              style={{ width: HANDLE_WIDTH }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
              {badge != null && badge > 0 && (
                <span className="absolute -top-2 -left-3 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center tabular-nums shadow">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </span>
          </button>
        )}

        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          inert={!open && live === null}
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
          {/* pan-y here too: touch-action stops at a scrolling box, so the
              dialog's own pan-y doesn't reach the buttons inside this one. */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5" style={{ touchAction: "pan-y" }}>{children}</div>
          <p className="px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-sm text-muted-foreground text-center">
            {handleStyle === "tab"
              ? "Click the green tab, press Esc or click outside to put it away"
              : "Swipe right to put it away — it works on top of the buttons too"}
          </p>
        </div>
      </div>
    </>,
    document.body,
  );
}
