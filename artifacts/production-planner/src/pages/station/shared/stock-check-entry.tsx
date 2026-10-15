/**
 * THE stock-check entry — used by every place the prep room records a stock
 * count (Graeme, 15 Oct 2026; Objective F): the "Stock check records for
 * today" table at the top of every prep screen, the inline counts on Raw
 * Meat / Bases & Sauces (StationStockChecks), and the count after finishing
 * an item on Main Prep and Raw Meat (including Main Prep's "Stock check
 * required" pop-up).
 *
 * Counted the way people physically count, with nothing to convert or pick
 * ("doesn't require someone to think hard"): an ingredient with a pack size
 * is FULL PACKS (big − / + stepper) plus the OPENED pack (None / ¼ / ½ / ¾,
 * or weigh an odd amount); one without is a single amount with its unit in
 * big text and an example. A plain-words read-back shows the total before
 * saving ("3 full packs + ½ a pack = 350 g"), and a total way out against
 * the ingredient's recent counts asks "check?" and needs a second tap.
 * Saved in the ingredient's own unit to the same endpoint as ever. Rules:
 * stock-count-units.ts.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Minus, Package, Plus, X as XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { guardedFetch } from "@/hooks/use-guarded-action";
import { useModalScrollKeeper, useNoScrollAutoFocus } from "@/hooks/use-modal-scroll";
import { toastDraftBlocked } from "./prep-helpers";
import {
  OPENED_FRACTIONS,
  describePackCount,
  formatNativeStock,
  nativeExample,
  openedCustomUnit,
  packCountToNative,
  packLabel,
  parseStockAmount,
  sanityMessage,
  stockCountMode,
  stockCountSanity,
  type OpenedPack,
} from "./stock-count-units";
import { formatCount, packNoun, unitWord } from "@workspace/units";

export interface StockCheckEntryIngredient {
  id: number;
  name: string;
  unit: string;
  packWeight?: number | string | null;
}

interface CommonProps {
  ingredient: StockCheckEntryIngredient;
  /** The day the count is recorded against (the plan being prepped for). */
  checkDate: string;
  isDraft?: boolean;
  /** The count already recorded today, in the ingredient's own unit. */
  currentNative?: number | null;
  /** What today's plan needs, in the ingredient's own unit — only used for
   *  the sanity check when the ingredient has no count history. */
  planNeedNative?: number | null;
  /** After a successful save, with the stored (native) quantity. */
  onSaved?: (nativeQty: number) => void;
}

/** Recent counts per ingredient (native units), for the sanity check. */
export function useStockCheckHistory(checkDate: string) {
  return useQuery<Record<string, number[]>>({
    queryKey: ["stock-check-history", checkDate],
    enabled: !!checkDate,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const r = await fetch(`/api/stock-check-history?before=${encodeURIComponent(checkDate)}`, { credentials: "include" });
      if (!r.ok) throw new Error(`Stock history failed to load (${r.status})`);
      const d = await r.json();
      return (d?.recent ?? {}) as Record<string, number[]>;
    },
  });
}

/** "500 g (5 packs)" — a recorded count, with packs when it has a size. */
export function recordedStockLabel(nativeQty: number, ing: StockCheckEntryIngredient): string {
  const base = formatNativeStock(nativeQty, ing);
  const pw = Number(ing.packWeight);
  if (!Number.isFinite(pw) || pw <= 0 || nativeQty <= 0) return base;
  const packs = Math.round((nativeQty / pw) * 100) / 100;
  return `${base} (${formatCount(packs)} ${packNoun(ing.unit, packs)})`;
}

/** The count form itself — embed it in any card or modal. */
export function StockCheckEntryForm({
  ingredient, checkDate, isDraft = false, currentNative, planNeedNative, onSaved, onCancel, cancelLabel = "Cancel", autoFocus = true,
}: CommonProps & {
  onCancel?: () => void;
  cancelLabel?: string;
  autoFocus?: boolean;
}) {
  const queryClient = useQueryClient();
  const mode = stockCountMode(ingredient);
  // Packs mode: full packs (stepper or typed) + the opened pack. The opened
  // pack starts UNANSWERED — "None" is one tap, but it's a choice they make,
  // so an untouched form can't save a silent zero.
  const [fullRaw, setFullRaw] = useState("0");
  const [opened, setOpened] = useState<OpenedPack | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customRaw, setCustomRaw] = useState("");
  // Native mode: one amount in the ingredient's own unit.
  const [amountRaw, setAmountRaw] = useState("");
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const amountRef = useNoScrollAutoFocus<HTMLInputElement>(autoFocus && mode === "native");
  const { data: history } = useStockCheckHistory(checkDate);

  const reset = () => {
    setFullRaw("0"); setOpened(null); setCustomOpen(false); setCustomRaw(""); setAmountRaw(""); setArmed(false);
  };
  // A different ingredient (the forced pop-up moving on) starts clean.
  useEffect(reset, [ingredient.id]);
  // Any change after an "are you sure?" needs the check again.
  const touched = () => setArmed(false);

  const fullPacks = parseStockAmount(fullRaw);
  const fullOk = fullPacks != null && Number.isInteger(fullPacks);
  let nativeQty: number | null = null;
  let readBack: string | null = null;
  if (mode === "packs") {
    if (fullOk && opened) {
      nativeQty = packCountToNative(fullPacks!, opened, ingredient);
      readBack = describePackCount(fullPacks!, opened, ingredient);
    }
  } else {
    const amount = parseStockAmount(amountRaw);
    if (amount != null) {
      nativeQty = amount;
      readBack = `${formatNativeStock(amount, ingredient)} left`;
    }
  }
  const sanity = nativeQty != null
    ? stockCountSanity({ nativeQty, recentNative: history?.[String(ingredient.id)], planNeedNative })
    : { level: "ok" as const };
  const warning = sanityMessage(sanity, ingredient);
  const canSave = nativeQty != null && !saving;

  const save = async () => {
    if (nativeQty == null || saving) return;
    if (isDraft) { toastDraftBlocked(); return; }
    if (warning && !armed) { setArmed(true); return; }
    setSaving(true);
    try {
      await guardedFetch("/api/production-plans/stock-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId: ingredient.id, checkDate, quantity: nativeQty }),
      });
      toast({ title: "Stock check saved", description: `${ingredient.name}: ${readBack ?? recordedStockLabel(nativeQty, ingredient)}` });
      void queryClient.invalidateQueries({ queryKey: ["prep-stock-checks"] });
      void queryClient.invalidateQueries({ queryKey: ["station-stock-checks"] });
      void queryClient.invalidateQueries({ queryKey: ["reminder-stock-checks"] });
      const saved = nativeQty;
      reset();
      onSaved?.(saved);
    } catch (err) {
      toast({ title: "Not saved", description: err instanceof Error ? err.message : "Stock check failed to save — please try again", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const stepBtn = "w-16 h-16 rounded-xl border-2 border-border bg-background text-foreground flex items-center justify-center hover:border-blue-400 active:scale-95 disabled:opacity-40";
  const noun = packNoun(ingredient.unit, 2);
  const noun1 = packNoun(ingredient.unit, 1);
  const customUnit = openedCustomUnit(ingredient);
  const nativeWord = unitWord(ingredient.unit, 2) || ingredient.unit;

  return (
    <div className="space-y-4">
      {currentNative != null && (
        <p className="text-sm text-muted-foreground">
          Recorded today: <span className="font-semibold text-foreground">{recordedStockLabel(currentNative, ingredient)}</span>
          {" "}— a new count replaces it.
        </p>
      )}

      {mode === "packs" ? (
        <>
          <div className="space-y-2">
            <label htmlFor={`sc-full-${ingredient.id}`} className="block text-base font-bold">
              Full {noun} <span className="font-semibold text-muted-foreground">({packLabel(ingredient)})</span>
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label={`One fewer full ${noun1}`}
                className={stepBtn}
                disabled={!fullOk || fullPacks! <= 0}
                onClick={() => { setFullRaw(String(Math.max(0, (fullPacks ?? 0) - 1))); touched(); }}
              >
                <Minus className="w-7 h-7" />
              </button>
              <input
                id={`sc-full-${ingredient.id}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={fullRaw}
                onFocus={e => e.currentTarget.select()}
                onChange={e => { setFullRaw(e.target.value); touched(); }}
                className={cn(
                  "w-28 h-16 px-3 text-4xl font-bold text-center tabular-nums bg-background border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400",
                  fullOk ? "border-blue-300 dark:border-blue-700" : "border-red-500",
                )}
              />
              <button
                type="button"
                aria-label={`One more full ${noun1}`}
                className={stepBtn}
                onClick={() => { setFullRaw(String((fullOk ? fullPacks! : 0) + 1)); touched(); }}
              >
                <Plus className="w-7 h-7" />
              </button>
            </div>
            {!fullOk && <p className="text-sm text-red-600">Whole {noun} only — the opened one goes below.</p>}
          </div>

          <div className="space-y-2">
            <p className="text-base font-bold">Opened {noun1} — how much is left in it?</p>
            <div className="grid grid-cols-4 gap-2">
              {OPENED_FRACTIONS.map(f => {
                const on = !customOpen && opened?.kind === "fraction" && opened.fraction === f.fraction;
                return (
                  <button
                    key={f.label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => { setCustomOpen(false); setCustomRaw(""); setOpened({ kind: "fraction", fraction: f.fraction }); touched(); }}
                    className={cn(
                      "h-16 rounded-xl border-2 font-bold transition-colors active:scale-[0.98]",
                      f.fraction === 0 ? "text-lg" : "text-3xl",
                      on ? "bg-blue-600 border-blue-700 text-white shadow" : "bg-background border-border hover:border-blue-400",
                    )}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
            {!customOpen ? (
              <button
                type="button"
                onClick={() => { setCustomOpen(true); setOpened(null); touched(); }}
                className="text-sm text-blue-700 dark:text-blue-300 underline underline-offset-2 py-2"
              >
                Odd amount? Enter {customUnit === "g" ? "grams" : unitWord(customUnit, 2)} instead
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`${customUnit} left in the opened ${noun1}`}
                  value={customRaw}
                  placeholder="0"
                  onChange={e => {
                    setCustomRaw(e.target.value);
                    const n = parseStockAmount(e.target.value);
                    setOpened(n == null ? null : { kind: "custom", amount: n });
                    touched();
                  }}
                  className="w-36 h-14 px-3 text-2xl font-bold text-right tabular-nums bg-background border-2 border-blue-300 dark:border-blue-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <span className="text-2xl font-bold">{customUnit}</span>
                <span className="text-sm text-muted-foreground">in the opened {noun1}</span>
                <button
                  type="button"
                  onClick={() => { setCustomOpen(false); setCustomRaw(""); setOpened(null); touched(); }}
                  className="ml-auto text-sm text-muted-foreground underline underline-offset-2 py-2"
                >
                  Use None / ¼ / ½ / ¾
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <label htmlFor={`sc-amount-${ingredient.id}`} className="block text-base font-bold">
            How much {ingredient.name.toLowerCase()} is left?
          </label>
          <div className="flex items-center gap-3">
            <input
              id={`sc-amount-${ingredient.id}`}
              ref={amountRef}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amountRaw}
              onChange={e => { setAmountRaw(e.target.value); touched(); }}
              placeholder="0"
              className={cn(
                "flex-1 min-w-0 h-16 px-4 text-4xl font-bold text-right tabular-nums bg-background border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400",
                amountRaw !== "" && parseStockAmount(amountRaw) == null ? "border-red-500" : "border-blue-300 dark:border-blue-700",
              )}
            />
            <span className="text-4xl font-bold">{nativeWord}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold">{nativeWord}</span> — {nativeExample(ingredient.unit)}. Type 0 if there&rsquo;s none left.
          </p>
        </div>
      )}

      {readBack && (
        <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-300 font-semibold">You&rsquo;re saving</p>
          <p className="text-lg font-bold text-blue-900 dark:text-blue-100">{readBack}</p>
        </div>
      )}

      {warning && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-400 px-4 py-3 flex gap-2" role="alert">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-900 dark:text-amber-200">{warning}</p>
            {armed && (
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 mt-1">
                Counted again and it&rsquo;s right? Tap &ldquo;Yes, it&rsquo;s right — save&rdquo;.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-5 min-h-[56px] rounded-xl text-base font-semibold border border-border text-muted-foreground hover:bg-secondary/60 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className={cn(
            "flex-1 min-h-[56px] rounded-xl text-lg font-bold transition-colors px-3",
            !canSave
              ? "bg-blue-200 text-blue-500 cursor-not-allowed dark:bg-blue-900/30 dark:text-blue-500"
              : warning
                ? "bg-amber-600 text-white hover:bg-amber-700 active:scale-[0.98]"
                : "bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]",
          )}
        >
          {saving
            ? <span className="inline-flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Saving…</span>
            : warning && armed
              ? "Yes, it's right — save"
              : mode === "packs" && !opened
                ? `Tap the opened ${noun1} first`
                : "Save stock check"}
        </button>
      </div>
    </div>
  );
}

/** The closable dialog around the form. Render it only while open. */
export function StockCheckDialog(props: CommonProps & { onClose: () => void }) {
  const { ingredient, onClose, onSaved } = props;
  useModalScrollKeeper();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Stock check: ${ingredient.name}`}
        className="bg-card text-foreground border-2 border-blue-500 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-border/60">
          <Package className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-xl leading-tight">Stock check</h2>
            <p className="text-base font-semibold text-blue-700 dark:text-blue-300 truncate">{ingredient.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 -mr-2 -mt-1 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary"
          >
            <XIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          <StockCheckEntryForm
            {...props}
            onSaved={q => { onSaved?.(q); onClose(); }}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}

/** The big "Stock check" button per item; opens the dialog. Shows what's
 *  recorded once there's a count, and tapping it again recounts. */
export function StockCheckButton({ className, ...props }: CommonProps & { className?: string }) {
  const [open, setOpen] = useState(false);
  const recorded = props.currentNative != null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "min-h-[48px] px-4 rounded-xl text-base font-bold inline-flex items-center gap-2 transition-colors active:scale-[0.98]",
          recorded
            ? "bg-emerald-50 text-emerald-800 border-2 border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
            : "bg-blue-600 text-white hover:bg-blue-700 shadow",
          className,
        )}
      >
        <Package className="w-5 h-5 flex-shrink-0" />
        {recorded
          ? <span className="text-left leading-tight">{recordedStockLabel(props.currentNative!, props.ingredient)}<span className="block text-xs font-medium opacity-80">Tap to recount</span></span>
          : "Stock check"}
      </button>
      {open && <StockCheckDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
