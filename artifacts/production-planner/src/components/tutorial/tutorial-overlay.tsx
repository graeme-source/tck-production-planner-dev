/**
 * The walkthrough engine (Graeme, 27 Oct 2026: "click one, and it walks
 * them through how to use it, what the purpose is and why it's useful";
 * objectives H and F). Home-grown and small on purpose — no tour library.
 *
 * Each step points at a real element on the screen by its stable
 * `data-tour="…"` attribute: the page is dimmed around it, the element is
 * ringed, and a card beside it says what it is, why it helps and how to use
 * it. A step whose element isn't on screen right now (a button that only
 * shows on the done screen, say) shows centred with a note instead of
 * breaking. Next / Back / Close; Escape or the X closes it at any time.
 * Steps are data (validated by @workspace/station-changes parseTutorial).
 */
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Check, Info, X } from "lucide-react";
import { stepAfter, tourSelector, type Tutorial } from "@workspace/station-changes";
import { useReportPromptShowing } from "@/lib/prompt-presence";
import { cn } from "@/lib/utils";

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 8;
const CARD_W = 420;

function findTarget(selector: string | null): HTMLElement | null {
  if (!selector) return null;
  // The first one that's actually showing (several flavour panels can carry
  // the same button; hidden copies have no size).
  const all = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return all.find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) ?? null;
}

export function TutorialOverlay({ tutorial, heading, onClose }: {
  tutorial: Tutorial;
  /** The change's title, shown small above each step. */
  heading?: string;
  /** finished = they reached the end with Done. */
  onClose: (finished: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  // Which step's target has been looked for, so "isn't on screen" never
  // flashes up before the first look.
  const [measuredFor, setMeasuredFor] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const steps = tutorial.steps;
  const step = steps[Math.min(index, steps.length - 1)];
  const selector = step ? tourSelector(step) : null;
  useReportPromptShowing("tutorial", true);

  // Bring the target into view once per step, then follow it (it can move
  // as the page re-renders, scrolls or appears a moment later).
  useLayoutEffect(() => {
    const el = findTarget(selector);
    if (el) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, [selector]);

  useEffect(() => {
    let frame = 0;
    setRect(null);
    setMeasuredFor(null);
    const measure = () => {
      const el = findTarget(selector);
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      setMeasuredFor(selector);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect(prev => (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height)
        ? prev : { top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const tick = () => { measure(); frame = window.setTimeout(tick, 250) as unknown as number; };
    frame = window.setTimeout(tick, 250) as unknown as number;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [selector]);

  const go = useCallback((dir: "next" | "back") => {
    const r = stepAfter(index, steps.length, dir);
    if (r.finished) { onClose(true); return; }
    setIndex(r.index);
  }, [index, steps.length, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(false); }
      if (e.key === "ArrowRight") { e.preventDefault(); go("next"); }
      if (e.key === "ArrowLeft") { e.preventDefault(); go("back"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  if (!step) return null;
  const isLast = index >= steps.length - 1;
  const missing = !!selector && measuredFor === selector && !rect;
  const centred = !rect;

  // Card placement: below the target if it fits, else above, else centred.
  const cardW = Math.min(CARD_W, viewport.w - 32);
  let cardStyle: React.CSSProperties | undefined;
  if (rect) {
    const left = Math.max(16, Math.min(rect.left + rect.width / 2 - cardW / 2, viewport.w - cardW - 16));
    const below = rect.top + rect.height + PAD + 12;
    const spaceBelow = viewport.h - below;
    const spaceAbove = rect.top - PAD - 12;
    if (spaceBelow >= 220) cardStyle = { left, top: below, width: cardW, maxHeight: spaceBelow - 16 };
    else if (spaceAbove >= 220) cardStyle = { left, bottom: viewport.h - spaceAbove, width: cardW, maxHeight: spaceAbove - 16 };
    // A tall target leaves no room either side: pin the card to the bottom
    // of the screen so the ring stays visible above it.
    else cardStyle = { left, bottom: 16, width: cardW, maxHeight: "60dvh" };
  }

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={`How to use: ${heading ?? step.title}`}>
      {rect ? (
        // The ring around the real element; its huge shadow dims the rest.
        <div
          className="absolute rounded-xl ring-4 ring-primary transition-all duration-200 pointer-events-none"
          style={{
            top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      <div
        className={cn(
          "absolute bg-card text-card-foreground border-2 border-primary/40 rounded-2xl shadow-2xl flex flex-col max-h-[92dvh]",
          centred && "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
        )}
        style={centred ? { width: cardW } : cardStyle}
      >
        <div className="flex items-start gap-3 px-5 pt-4">
          <div className="min-w-0 flex-1">
            {heading && <p className="text-xs font-bold uppercase tracking-wider text-primary truncate">{heading}</p>}
            <h2 className="text-xl font-bold leading-snug mt-0.5">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={() => onClose(false)}
            aria-label="Close the walkthrough"
            className="shrink-0 w-11 h-11 -mr-2 -mt-1 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pt-2 pb-3 overflow-y-auto">
          <p className="text-base leading-relaxed whitespace-pre-line">{step.body}</p>
          {missing && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{step.hiddenNote || "This isn't on the screen right now. It appears when it's needed."}</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 pb-4 pt-1 border-t border-border/60">
          <span className="text-sm font-semibold text-muted-foreground tabular-nums mr-auto pt-3">
            {index + 1} of {steps.length}
          </span>
          <div className="flex items-center gap-2 pt-3">
            <button
              type="button"
              onClick={() => go("back")}
              disabled={index === 0}
              className="h-12 px-4 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-1 disabled:opacity-40 hover:bg-secondary"
            >
              <ChevronLeft className="w-5 h-5" /> Back
            </button>
            <button
              type="button"
              onClick={() => go("next")}
              className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-1 hover:bg-primary/90 active:scale-[0.98]"
            >
              {isLast ? <><Check className="w-5 h-5" /> Done</> : <>Next <ChevronRight className="w-5 h-5" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
