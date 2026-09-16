/**
 * The station queue pattern (Graeme, 2026-09-16): one pinned recipe panel on
 * screen, and the full production queue behind a fixed bottom dock — Prev /
 * Queue / Next always in the same place, so nobody scrolls up and down
 * hunting for where they are in the run. Built for ovens first, now shared
 * by every station that works through a recipe queue.
 *
 * - QueueDock: the fixed bottom bar. Sits above StationLayout's bottom
 *   padding (pb-20) so it never covers the panel's own buttons.
 * - QueueSheet: the bottom sheet listing the whole run. Rendered = open;
 *   unmount to close. Stations supply their own rows (each station's row
 *   carries different numbers) and optional footer content (session
 *   totals, KPIs). Modal rules: X + backdrop close, capped height,
 *   internal scroll.
 */
import React from "react";
import { ChevronLeft, ChevronRight, ListOrdered, CheckCircle2, X } from "lucide-react";

export function QueueDock({ label, doneCount, total, prevDisabled, nextDisabled, onPrev, onNext, onOpenQueue }: {
  /** Button wording, e.g. "Oven Queue" / "Build Queue — Line 1". */
  label: string;
  doneCount: number;
  total: number;
  prevDisabled: boolean;
  nextDisabled: boolean;
  onPrev: () => void;
  onNext: () => void;
  onOpenQueue: () => void;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={prevDisabled}
          className="flex items-center gap-1 px-4 py-3 rounded-xl border border-border font-semibold text-sm hover:bg-secondary/60 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" /> Prev
        </button>
        <button
          onClick={onOpenQueue}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 transition-colors"
        >
          <ListOrdered className="w-5 h-5" />
          {label}
          <span className="tabular-nums font-normal opacity-90">· {doneCount}/{total} done</span>
        </button>
        <button
          onClick={onNext}
          disabled={nextDisabled}
          className="flex items-center gap-1 px-4 py-3 rounded-xl border border-border font-semibold text-sm hover:bg-secondary/60 disabled:opacity-30 transition-colors"
        >
          Next <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

export function QueueSheet({ title, allDone, onClose, children }: {
  title: string;
  /** Shows the green "All done" chip in the header. */
  allDone: boolean;
  onClose: () => void;
  /** Queue rows first, then any footer content (totals, KPIs) — the whole
   *  area scrolls together. */
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border rounded-t-2xl shadow-2xl max-h-[85dvh] flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
          <h3 className="font-semibold text-base">{title}</h3>
          <div className="flex items-center gap-3">
            {allDone && (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" /> All done
              </span>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-secondary/60 text-muted-foreground"
              aria-label="Close the queue"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  );
}
