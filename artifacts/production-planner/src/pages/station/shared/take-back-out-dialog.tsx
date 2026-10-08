/**
 * "Take N packs back OUT?" — the wrapping station's undo, made deliberate
 * (Graeme, 2026-10-08). Two steps, never one tap:
 *
 *   1. What changes — packs, recipe, fridge before → after, still to wrap
 *      before → after — and WHY (Added twice / Wrong recipe / Not actually
 *      wrapped / Other: …). Next stays off until a reason is chosen.
 *   2. Press and HOLD for 1.5 s to confirm. Letting go early does nothing.
 *
 * Closable at every point (X, Cancel, Back, Escape, tapping outside), card
 * capped at 92dvh with internal scroll, big targets for gloved hands on the
 * iPad. The words and numbers come from lib/wrapping-undo.ts (tested).
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HOLD_TO_CONFIRM_MS,
  UNDO_OTHER_MAX,
  UNDO_REASON_OPTIONS,
  holdProgress,
  reasonReady,
  type TakeBackOutSummary,
  type UndoReason,
} from "@/lib/wrapping-undo";

export function TakeBackOutDialog({
  summary,
  onCancel,
  onConfirm,
}: {
  summary: TakeBackOutSummary;
  onCancel: () => void;
  /** Resolves when the server has taken them out; rejects to stay open. */
  onConfirm: (reason: UndoReason, otherText: string) => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [reason, setReason] = useState<UndoReason | null>(null);
  const [otherText, setOtherText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = reasonReady(reason, otherText);
  const reasonLabel = UNDO_REASON_OPTIONS.find(o => o.code === reason)?.label ?? "";

  // Press-and-hold state. The hold only counts while the pointer (or the
  // Space/Enter key) stays down; any release before 1.5 s resets it.
  const [progress, setProgress] = useState(0);
  const holdStart = useRef<number | null>(null);
  // A plain interval (not requestAnimationFrame) so the hold is timed the
  // same whether or not the browser is painting frames.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fired = useRef(false);

  const clearTimer = () => {
    if (timer.current != null) clearInterval(timer.current);
    timer.current = null;
  };

  const stopHold = () => {
    holdStart.current = null;
    clearTimer();
    if (!fired.current) setProgress(0);
  };

  const fire = async () => {
    if (fired.current || !reason) return;
    fired.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason, otherText);
    } catch (err) {
      fired.current = false;
      setProgress(0);
      setError(err instanceof Error ? err.message : "Couldn't take them out — nothing was changed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const tick = () => {
    if (holdStart.current == null) return;
    const p = holdProgress(performance.now() - holdStart.current);
    setProgress(p);
    if (p >= 1) {
      holdStart.current = null;
      clearTimer();
      void fire();
    }
  };

  const startHold = () => {
    if (busy || fired.current || holdStart.current != null) return;
    holdStart.current = performance.now();
    clearTimer();
    timer.current = setInterval(tick, 40);
  };

  useEffect(() => clearTimer, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const close = () => { if (!busy) onCancel(); };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-3 sm:p-4"
      onClick={close}
      data-testid="take-back-out-dialog"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="take-back-out-title"
        onClick={e => e.stopPropagation()}
        className="relative bg-card border-2 border-red-400 dark:border-red-700 rounded-2xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col"
      >
        <button
          type="button"
          aria-label="Close — keep them in"
          onClick={close}
          disabled={busy}
          className="absolute top-3 right-3 w-12 h-12 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="overflow-y-auto px-5 sm:px-6 pt-5 pb-4 space-y-4">
          <div className="flex items-start gap-3 pr-12">
            <div className="w-11 h-11 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                Step {step} of 2
              </p>
              <h2 id="take-back-out-title" className="font-display font-bold text-xl leading-snug">
                {summary.question}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Only do this if they were never wrapped or were counted twice. Packs that were really
                wrapped stay in — even if they've since gone to packing.
              </p>
            </div>
          </div>

          {/* What changes */}
          <div className="rounded-xl border border-border bg-muted/30 divide-y divide-border/60">
            <ChangeRow label="Recipe" value={summary.recipe} />
            <ChangeRow label="Taking out" value={`${summary.qty} ${summary.unit}`} strong />
            <ChangeRow
              label={summary.whereLabel === "the fridge" ? "In the fridge" : "In the freezer"}
              before={summary.storedBefore}
              after={summary.storedAfter}
            />
            <ChangeRow label="Still to wrap" before={summary.stillToWrapBefore} after={summary.stillToWrapAfter} />
          </div>

          {step === 1 ? (
            <div className="space-y-2">
              <p className="text-base font-semibold">Why are they coming out?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {UNDO_REASON_OPTIONS.map(opt => (
                  <button
                    key={opt.code}
                    type="button"
                    onClick={() => setReason(opt.code)}
                    aria-pressed={reason === opt.code}
                    className={cn(
                      "min-h-[60px] rounded-xl border-2 px-4 py-2 text-left transition-colors",
                      reason === opt.code
                        ? "border-red-500 bg-red-50 dark:bg-red-950/40"
                        : "border-border hover:bg-secondary/50",
                    )}
                  >
                    <span className="block text-base font-semibold">{opt.label}</span>
                    <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                  </button>
                ))}
              </div>
              {reason === "other" && (
                <input
                  type="text"
                  value={otherText}
                  maxLength={UNDO_OTHER_MAX}
                  onChange={e => setOtherText(e.target.value)}
                  placeholder="What happened?"
                  autoFocus
                  className="w-full h-12 rounded-xl border-2 border-border bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">
                Reason: <span className="font-semibold">{reasonLabel}{reason === "other" && otherText.trim() ? ` — ${otherText.trim()}` : ""}</span>.
                Your name goes on the stock history.
              </p>
              {error && (
                <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* Actions — outside the scroll area so they're always reachable. */}
        <div className="border-t border-border px-5 sm:px-6 py-4 flex flex-col-reverse sm:flex-row gap-2 sm:items-center">
          {step === 1 ? (
            <>
              <button
                type="button"
                onClick={close}
                className="h-14 px-6 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary/50"
              >
                Cancel — keep them in
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!ready}
                className="sm:ml-auto h-14 px-6 rounded-xl bg-red-600 text-white text-base font-semibold hover:bg-red-700 disabled:opacity-40 inline-flex items-center justify-center gap-2"
              >
                Next <ArrowRight className="w-5 h-5" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => { setStep(1); stopHold(); setError(null); }}
                disabled={busy}
                className="h-14 px-6 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary/50 disabled:opacity-40"
              >
                Back
              </button>
              <button
                type="button"
                aria-label={summary.holdLabel}
                disabled={busy}
                onPointerDown={e => {
                  startHold();
                  // Keep the hold if the finger drifts a little; capture can
                  // throw for a pointer the browser no longer tracks.
                  try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* hold still runs */ }
                }}
                onPointerUp={stopHold}
                onPointerCancel={stopHold}
                onPointerLeave={stopHold}
                onKeyDown={e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); startHold(); } }}
                onKeyUp={e => { if (e.key === " " || e.key === "Enter") stopHold(); }}
                onContextMenu={e => e.preventDefault()}
                className="sm:ml-auto relative overflow-hidden h-16 px-6 rounded-xl bg-red-600 text-white text-base font-bold select-none touch-none disabled:opacity-60 min-w-[260px]"
                style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none" } as CSSProperties}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-red-900/60"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
                <span className="relative inline-flex items-center gap-2">
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                  {busy ? "Taking them out…" : progress > 0 ? "Keep holding…" : summary.holdLabel}
                </span>
              </button>
            </>
          )}
        </div>
        {step === 2 && (
          <p className="px-5 sm:px-6 pb-4 -mt-2 text-xs text-muted-foreground text-right">
            Press and hold for {HOLD_TO_CONFIRM_MS / 1000} seconds. Let go to stop.
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ChangeRow({ label, value, before, after, strong }: {
  label: string;
  value?: string;
  before?: number;
  after?: number;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {value != null ? (
        <span className={cn("text-base text-right", strong ? "font-bold text-red-600 dark:text-red-400" : "font-semibold")}>{value}</span>
      ) : (
        <span className="text-base font-semibold tabular-nums inline-flex items-center gap-2">
          {before}
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
          <span className={cn(after !== before && "text-red-600 dark:text-red-400")}>{after}</span>
        </span>
      )}
    </div>
  );
}
