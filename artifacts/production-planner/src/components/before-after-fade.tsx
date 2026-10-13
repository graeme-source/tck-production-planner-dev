/**
 * Before and after in ONE frame, cross-fading back and forth forever with a
 * big BEFORE / AFTER label on each — the "animated GIF" Graeme asked for
 * (2026-10-13), done in the browser so the photos keep full quality.
 * Objectives E and H: the change is visible at a glance, no scrolling
 * between two photos.
 *
 *   - Loops before → after → before, ~3 s on each with a 0.8 s fade.
 *   - Tap to pause / play; a "Paused — tap to play" chip says so, so nobody
 *     thinks it's stuck. Hold to compare: the other photo shows while the
 *     finger is down. The Before | After buttons jump to a side and hold it.
 *   - prefers-reduced-motion: no fade loop at all — the buttons (or a tap)
 *     switch sides instantly.
 *   - The frame takes the before photo's shape (clamped) and both photos
 *     are drawn object-contain on a dark background: shot the same way
 *     round they fill it edge to edge; shot differently, the odd one is
 *     letterboxed rather than cropped, because cropping could cut off the
 *     very thing that changed.
 *   - Images lazy-load; the loop only runs once both have loaded and while
 *     the frame is on screen, so a long feed isn't ticking off-screen.
 *
 * The timing and state machine are pure and tested in
 * lib/before-after-fade.ts.
 */
import { useEffect, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import {
  FADE_CYCLE_MS,
  FADE_TRANSITION_MS,
  HOLD_TO_COMPARE_MS,
  PRESS_MOVE_SLOP_PX,
  fadeFrameAspect,
  fadeReducer,
  fadeRunning,
  initialFadeState,
  showPausedChip,
  visibleSide,
  type FadeSide,
} from "@/lib/before-after-fade";

const SIDES: FadeSide[] = ["before", "after"];
const LABEL: Record<FadeSide, string> = { before: "Before", after: "After" };

export function BeforeAfterFade({
  beforeSrc,
  afterSrc,
  large = false,
  maxHeight = "75vh",
  className,
}: {
  beforeSrc: string;
  afterSrc: string;
  /** Bigger label and buttons — a TV watched from across the kitchen. */
  large?: boolean;
  /** CSS height the frame never grows past, e.g. "75vh". */
  maxHeight?: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [state, dispatch] = useReducer(fadeReducer, reduced, initialFadeState);
  useEffect(() => { dispatch({ type: "setAuto", auto: !reduced }); }, [reduced]);

  const [aspect, setAspect] = useState(() => fadeFrameAspect(undefined, undefined));
  const [loaded, setLoaded] = useState<Record<FadeSide, boolean>>({ before: false, after: false });

  // Only tick while on screen.
  const frameRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The loop: one flip per cycle, rescheduled from every flip, so a resume
  // or a button press always gets a full look before it moves on.
  const running = fadeRunning(state) && inView && loaded.before && loaded.after;
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => dispatch({ type: "tick" }), FADE_CYCLE_MS);
    return () => window.clearTimeout(t);
  }, [running, state.side]);

  // Tap vs hold. A finger that moves is a scroll or a slide swipe: neither.
  const press = useRef<{ x: number; y: number; timer: number; held: boolean; cancelled: boolean } | null>(null);
  const endPress = (cancel: boolean) => {
    const p = press.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    press.current = null;
    if (p.held) dispatch({ type: "holdEnd" });
    else if (!cancel && !p.cancelled) dispatch({ type: "tap" });
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const timer = window.setTimeout(() => {
      if (!press.current || press.current.cancelled) return;
      press.current.held = true;
      dispatch({ type: "holdStart" });
    }, HOLD_TO_COMPARE_MS);
    press.current = { x: e.clientX, y: e.clientY, timer, held: false, cancelled: false };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const p = press.current;
    if (!p || p.cancelled) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > PRESS_MOVE_SLOP_PX) endPress(true);
  };

  const shown = visibleSide(state);
  const paused = showPausedChip(state);
  const src: Record<FadeSide, string> = { before: beforeSrc, after: afterSrc };

  return (
    <div
      ref={frameRef}
      role="button"
      tabIndex={0}
      aria-label={state.auto
        ? `Before and after photos, fading between them. Showing ${LABEL[shown].toLowerCase()}. ${paused ? "Paused — press to play." : "Press to pause."}`
        : `Before and after photos. Showing ${LABEL[shown].toLowerCase()}. Press to switch.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endPress(false)}
      onPointerCancel={() => endPress(true)}
      onPointerLeave={() => endPress(true)}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dispatch({ type: "tap" }); }
      }}
      className={cn(
        "relative mx-auto w-full overflow-hidden rounded-xl bg-neutral-900 cursor-pointer select-none",
        "[-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/60",
        className,
      )}
      style={{ aspectRatio: String(aspect), maxHeight, maxWidth: `calc(${maxHeight} * ${aspect})` }}
    >
      {SIDES.map(side => (
        <div
          key={side}
          aria-hidden={shown !== side}
          className="absolute inset-0 transition-opacity ease-in-out motion-reduce:transition-none"
          style={{ opacity: shown === side ? 1 : 0, transitionDuration: `${FADE_TRANSITION_MS}ms` }}
        >
          <img
            src={src[side]}
            alt={`${LABEL[side]} photo`}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={e => {
              const img = e.currentTarget;
              setLoaded(l => (l[side] ? l : { ...l, [side]: true }));
              if (side === "before") setAspect(fadeFrameAspect(img.naturalWidth, img.naturalHeight));
            }}
            onError={() => setLoaded(l => ({ ...l, [side]: true }))}
            className="w-full h-full object-contain pointer-events-none"
          />
          {/* The label belongs to its photo, so it fades with it. */}
          <span className={cn(
            "absolute rounded-full bg-black/65 text-white font-extrabold uppercase tracking-wider shadow-lg pointer-events-none",
            large ? "top-4 left-4 text-3xl px-5 py-2" : "top-3 left-3 text-lg px-4 py-1.5",
          )}>
            {LABEL[side]}
          </span>
        </div>
      ))}

      {paused && (
        <span
          role="status"
          className={cn(
            "absolute rounded-full bg-black/75 text-white font-bold flex items-center gap-1.5 pointer-events-none",
            large ? "top-4 right-4 text-xl px-4 py-2" : "top-3 right-3 text-sm px-3 py-1.5",
          )}
        >
          <Pause className={large ? "w-5 h-5" : "w-4 h-4"} /> Paused — tap to play
        </span>
      )}

      {/* Before | After — jump to a side and hold it there. Kept out of the
          frame's own tap so pressing one doesn't also pause/play. */}
      <div
        className={cn(
          "absolute left-1/2 -translate-x-1/2 flex rounded-full bg-black/65 p-1 shadow-lg",
          large ? "bottom-4" : "bottom-3",
        )}
        onPointerDown={e => e.stopPropagation()}
        onPointerUp={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
      >
        {SIDES.map(side => (
          <button
            key={side}
            type="button"
            aria-pressed={shown === side}
            onClick={e => { e.stopPropagation(); dispatch({ type: "show", side }); }}
            className={cn(
              "rounded-full font-bold transition-colors",
              large ? "h-12 px-6 text-lg" : "h-10 px-4 text-sm",
              shown === side ? "bg-white text-black" : "text-white/85 hover:text-white",
            )}
          >
            {LABEL[side]}
          </button>
        ))}
      </div>
    </div>
  );
}
