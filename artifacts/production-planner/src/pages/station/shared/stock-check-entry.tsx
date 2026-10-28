/**
 * THE stock-check entry — used by every place a stock count is recorded
 * (Objective F): the "Stock check records for today" table at the top of
 * every prep screen, the inline counts on Raw Meat / Bases & Sauces
 * (StationStockChecks), the count after finishing an item on Main Prep and
 * Raw Meat (including Main Prep's "Stock check required" pop-up), and the
 * stock column on the Orders page.
 *
 * Two steps, so it's "almost impossible to get wrong" (Graeme, 19 Oct 2026 —
 * replacing the 15 Oct full-packs + opened-fraction entry, which was
 * "confusing"):
 *   1. One instruction, one button: "Weigh in KILOGRAMS" or "Count BOXES
 *      (1 box = 12 kg)" — the pack's own name since #327, 22 Oct 2026 —
 *      → "I understand — weigh in kilograms".
 *   A count far off what the app expected (last count + deliveries −
 *   usage), or zero straight after a positive count, asks "That's very
 *   different from what we'd expect — count again to be sure" / "That's
 *   zero — are you sure the shelf is empty?" and needs a second tap (#327).
 *   Blind: the expected figure is never shown (Graeme, 23 Oct 2026).
 *   2. One big number field with the unit huge and bold right after it, a
 *      Dictate button (spoken numbers: "five hundred and fifty"), and one
 *      big "Enter stock" button. A plain-words read-back says what will be
 *      saved ("550 g = 5.5 packs of 100g"); a count way out against recent
 *      counts asks "Are you sure — 5,500 g?" and needs a second tap.
 *   3. "You are updating the stock check for … to 70 g. Please confirm." —
 *      "Yes, update it" or "No, disregard this change" (Graeme, 28 Oct 2026:
 *      someone only looking at a count could overwrite it). Enter never
 *      confirms, and the empty box shows no grey 0 that could read as the
 *      current stock.
 *
 * The unit is the item's stock-check unit (ingredients.stock_check_unit,
 * GET /api/stock-check-units; resolveStockCheckUnit in @workspace/units).
 * The number is converted to the ingredient's own unit before saving, so
 * the endpoints and stored data are unchanged. Counts stay blind: nothing
 * here shows an expected figure.
 */
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Package, X as XIcon } from "lucide-react";
import {
  describeStockCount,
  formatStockCount,
  nativeToStockCount,
  resolveStockCheckUnit,
  stockCheckInstruction,
  stockCheckUnitName,
  stockCheckUnitSymbol,
  stockCountToNative,
  type StockCheckUnit,
  type StockCheckUnitItem,
} from "@workspace/units";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { guardedFetch } from "@/hooks/use-guarded-action";
import { useModalScrollKeeper, useNoScrollAutoFocus } from "@/hooks/use-modal-scroll";
import { DictateNumberButton } from "@/components/dictate-number-button";
import { toastDraftBlocked } from "./prep-helpers";
import { londonToday } from "@/lib/station-training";
import { expectedCountSanity, expectedSanityMessage, parseStockAmount, sanityMessage, stockCountSanity, useByWarning } from "./stock-count-units";

export interface StockCheckEntryIngredient {
  id: number;
  name: string;
  unit: string;
  packWeight?: number | string | null;
  stockInPacks?: boolean | null;
  stockCheckUnit?: string | null;
  /** What the pack is called (#327) — merged in from /api/stock-check-units. */
  packName?: string | null;
  /** "Require use-by date" ticked: the count offers an optional use-by (#165). */
  requiresUseByDate?: boolean;
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
  /** Save somewhere other than the prep stock-check endpoint (the Orders
   *  page). Gets the amount in the ingredient's own unit; throw to fail. */
  saveNative?: (nativeQty: number) => Promise<void>;
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

/** What the app expects this count to be (#327) — used only to decide
 *  whether to ask "are you sure?"; never shown (counts stay blind). */
export function useStockCheckExpected(ingredientId: number) {
  return useQuery<{ expectedNative: number | null; lastCountNative: number | null; coverage: string }>({
    queryKey: ["stock-check-expected", ingredientId],
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(`/api/stock-check-expected?ingredientId=${ingredientId}`, { credentials: "include" });
      if (!r.ok) throw new Error(`Expected stock failed to load (${r.status})`);
      return r.json();
    },
  });
}

type StockCheckUnitRow = StockCheckUnitItem & { resolved: StockCheckUnit; options: StockCheckUnit[]; requiresUseByDate?: boolean };
export const stockCheckUnitsQueryKey = ["stock-check-units"] as const;

/** Every ingredient's stock-check unit setting (GET /api/stock-check-units). */
export function useStockCheckUnits() {
  return useQuery<Record<string, StockCheckUnitRow>>({
    queryKey: stockCheckUnitsQueryKey,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = await fetch(`/api/stock-check-units`, { credentials: "include" });
      if (!r.ok) throw new Error(`Stock-check units failed to load (${r.status})`);
      const d = await r.json();
      return (d?.items ?? {}) as Record<string, StockCheckUnitRow>;
    },
  });
}

/** The ingredient with its saved stock-check setting merged in. */
function withSetting(ing: StockCheckEntryIngredient, units: Record<string, StockCheckUnitRow> | undefined): StockCheckEntryIngredient {
  const row = units?.[String(ing.id)];
  if (!row) return ing;
  return { ...ing, unit: row.unit ?? ing.unit, packWeight: row.packWeight ?? ing.packWeight, stockInPacks: row.stockInPacks, stockCheckUnit: row.stockCheckUnit, packName: row.packName ?? null, requiresUseByDate: row.requiresUseByDate ?? false };
}

/** "550 g", "12.4 kg" — a recorded (native) count, in the unit it's counted in. */
export function recordedStockLabel(nativeQty: number, ing: StockCheckEntryIngredient): string {
  const unit = resolveStockCheckUnit(ing);
  const count = nativeToStockCount(nativeQty, unit, ing);
  return count == null ? `${nativeQty} ${ing.unit}` : formatStockCount(Math.round(count * 1000) / 1000, unit, ing);
}

/** recordedStockLabel with each item's saved stock-check unit applied. */
export function useRecordedStockLabel() {
  const { data: units } = useStockCheckUnits();
  return useCallback(
    (nativeQty: number, ing: StockCheckEntryIngredient) => recordedStockLabel(nativeQty, withSetting(ing, units)),
    [units],
  );
}

/** Add the use-by to the count just saved (#165). */
async function putStockCheckUseBy(ingredientId: number, checkDate: string, useByDate: string) {
  const r = await fetch(`/api/stock-check-use-by`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ingredientId, checkDate, useByDate }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Use-by not saved (${r.status})`);
  }
}

async function postPrepStockCheck(ingredientId: number, checkDate: string, quantity: number) {
  await guardedFetch("/api/production-plans/stock-checks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ingredientId, checkDate, quantity }),
  });
}

/** The two-step count itself — embed it in any card or modal. */
export function StockCheckEntryForm({
  ingredient: ingredientProp, checkDate, isDraft = false, currentNative, planNeedNative, onSaved, saveNative,
  onCancel, cancelLabel = "Cancel",
}: CommonProps & {
  /** Shown as a small link on step 1 (e.g. "Skip" on the forced pop-up). */
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const queryClient = useQueryClient();
  const unitsQ = useStockCheckUnits();
  const ingredient = withSetting(ingredientProp, unitsQ.data);
  const unit = resolveStockCheckUnit(ingredient);
  const unitName = stockCheckUnitName(unit, ingredient);
  // "Count BOXES (1 box = 12 kg)" / "Weigh in KILOGRAMS" (#327).
  const instruction = stockCheckInstruction(unit, ingredient);

  const [step, setStep] = useState<"unit" | "amount">("unit");
  const [raw, setRaw] = useState("");
  const [useBy, setUseBy] = useState("");
  const [armed, setArmed] = useState(false);
  // "You are updating the stock check to … Please confirm" (Graeme, 28 Oct
  // 2026): a count only saves after a second, deliberate tap, so someone who
  // only meant to look can't overwrite the stock by accident.
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const amountRef = useNoScrollAutoFocus<HTMLInputElement>(step === "amount");
  const { data: history } = useStockCheckHistory(checkDate);
  const { data: expected } = useStockCheckExpected(ingredientProp.id);

  // A different ingredient (the forced pop-up moving on) starts again at step 1.
  useEffect(() => { setStep("unit"); setRaw(""); setUseBy(""); setArmed(false); setConfirming(false); }, [ingredientProp.id]);

  const setValue = (v: string) => { setRaw(v); setArmed(false); setConfirming(false); };
  const onDictated = useCallback((n: number) => { setRaw(String(n)); setArmed(false); setConfirming(false); }, []);
  const disregard = () => {
    setStep("unit"); setRaw(""); setUseBy(""); setArmed(false); setConfirming(false);
    toast({ title: "Not saved", description: `${ingredientProp.name}: the stock was left as it was.` });
  };

  const value = parseStockAmount(raw);
  const described = value != null ? describeStockCount(value, unit, ingredient) : null;
  const nativeQty = described?.native ?? null;
  const sanity = nativeQty != null
    ? stockCountSanity({ nativeQty, recentNative: history?.[String(ingredient.id)], planNeedNative })
    : { level: "ok" as const };
  // First: far off what the app expected, or zero straight after a positive
  // count (#327). Otherwise the older "way out against recent counts" check.
  const expectedSanity = nativeQty != null
    ? expectedCountSanity({
        nativeQty,
        expectedNative: expected?.expectedNative,
        lastCountNative: expected?.lastCountNative,
        usageTracked: expected != null && expected.coverage !== "untracked",
        packWeight: Number(ingredient.packWeight) || null,
      })
    : { level: "ok" as const };
  const warning = value != null
    ? expectedSanityMessage(expectedSanity, { value, unit, item: ingredient }) ?? sanityMessage(sanity, { value, unit, item: ingredient })
    : null;
  const invalid = raw.trim() !== "" && value == null;
  const canSave = nativeQty != null && !saving;
  const readBack = described ? [described.entered, ...described.extras].join(" = ") : null;
  // Optional use-by for "Require use-by date" items (#165): warned on when
  // it's today or already past — the count still saves.
  const useByNote = ingredient.requiresUseByDate && useBy ? useByWarning(useBy, londonToday()) : null;

  const save = async () => {
    if (nativeQty == null || saving) return;
    if (isDraft && !saveNative) { toastDraftBlocked(); return; }
    if (warning && !armed) { setArmed(true); return; }
    if (!confirming) { setConfirming(true); return; }
    setSaving(true);
    try {
      if (saveNative) await saveNative(nativeQty);
      else await postPrepStockCheck(ingredient.id, checkDate, nativeQty);
      let useBySaved = "";
      if (ingredient.requiresUseByDate && useBy) {
        try {
          await putStockCheckUseBy(ingredient.id, checkDate, useBy);
          useBySaved = `, use by ${new Date(useBy + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
        } catch (e) {
          toast({ title: "Count saved — use-by NOT saved", description: e instanceof Error ? e.message : "Try entering the use-by again.", variant: "destructive" });
        }
      }
      void queryClient.invalidateQueries({ queryKey: ["stock-check-use-by"] });
      toast({ title: "Stock check saved", description: `${ingredient.name}: ${readBack}${useBySaved}` });
      void queryClient.invalidateQueries({ queryKey: ["prep-stock-checks"] });
      void queryClient.invalidateQueries({ queryKey: ["station-stock-checks"] });
      void queryClient.invalidateQueries({ queryKey: ["reminder-stock-checks"] });
      const saved = nativeQty;
      setStep("unit"); setRaw(""); setUseBy(""); setArmed(false); setConfirming(false);
      onSaved?.(saved);
    } catch (err) {
      toast({ title: "Not saved", description: err instanceof Error ? err.message : "Stock check failed to save — please try again", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (unitsQ.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" /> Loading…
      </div>
    );
  }

  // ── Step 1: which unit — one sentence, one button ─────────────────────
  if (step === "unit") {
    return (
      <div className="space-y-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Step 1 of 2</p>
        <div className="space-y-2">
          <p className="text-2xl font-bold leading-snug">{instruction.verb}</p>
          <p className="text-5xl sm:text-6xl font-black uppercase tracking-tight text-blue-700 dark:text-blue-300 break-words">{instruction.what}</p>
          {instruction.detail && <p className="text-2xl font-bold text-foreground">({instruction.detail})</p>}
        </div>
        {currentNative != null && (
          <p className="text-sm text-muted-foreground">
            Already recorded today: <span className="font-semibold text-foreground">{recordedStockLabel(currentNative, ingredient)}</span>. A new count replaces it.
          </p>
        )}
        <button
          type="button"
          onClick={() => setStep("amount")}
          className="w-full min-h-[72px] rounded-2xl bg-blue-600 text-white text-xl font-bold hover:bg-blue-700 active:scale-[0.98] shadow-md px-4"
        >
          I understand — {instruction.verb === "Count" ? "count" : "weigh"} in {unitName}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-base text-muted-foreground underline underline-offset-2 py-2">
            {cancelLabel}
          </button>
        )}
      </div>
    );
  }

  // ── Step 2: one number, the unit huge right after it ──────────────────
  const symbol = stockCheckUnitSymbol(unit, ingredient, value ?? 2);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => { setStep("unit"); setArmed(false); }}
          className="inline-flex items-center gap-1.5 min-h-11 px-2 -ml-2 rounded-lg text-base font-semibold text-muted-foreground hover:bg-secondary/60"
        >
          <ArrowLeft className="w-5 h-5" /> Back
        </button>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Step 2 of 2</p>
      </div>

      <label htmlFor={`sc-amount-${ingredient.id}`} className="block text-xl font-bold">
        {instruction.verb === "Count" ? `How many ${unitName} are there?` : `How much is there, in ${unitName}?`}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={`sc-amount-${ingredient.id}`}
          ref={amountRef}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={raw}
          onChange={e => setValue(e.target.value)}
          // Enter never confirms — the confirm step needs its own tap.
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (!confirming) void save(); } }}
          readOnly={confirming}
          aria-describedby={`sc-unit-${ingredient.id}`}
          className={cn(
            "flex-1 min-w-0 h-24 px-4 text-6xl font-bold text-right tabular-nums bg-background border-4 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-300",
            invalid ? "border-red-500" : "border-blue-400 dark:border-blue-600",
          )}
        />
        <span id={`sc-unit-${ingredient.id}`} className="text-6xl font-black text-foreground flex-shrink-0">{symbol}</span>
      </div>
      {invalid && <p className="text-base font-semibold text-red-600">Numbers only — like 550 or 12.4.</p>}
      {!invalid && raw === "" && <p className="text-sm text-muted-foreground">Type 0 if there&rsquo;s none left.</p>}

      <DictateNumberButton onNumber={onDictated} />

      {ingredient.requiresUseByDate && (
        <div className="space-y-1.5">
          <label htmlFor={`sc-useby-${ingredient.id}`} className="block text-lg font-bold">
            Use-by date <span className="text-sm font-normal text-muted-foreground">(optional — the soonest one on the shelf)</span>
          </label>
          <input
            id={`sc-useby-${ingredient.id}`}
            type="date"
            value={useBy}
            onChange={e => setUseBy(e.target.value)}
            className="w-full h-14 px-4 text-xl font-semibold bg-background border-2 border-border rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-300"
          />
          {useByNote && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border-2 border-red-500 px-4 py-3 flex gap-2" role="alert">
              <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-lg font-bold text-red-800 dark:text-red-200">{useByNote}</p>
            </div>
          )}
        </div>
      )}

      {readBack && (
        <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-300 font-semibold">You&rsquo;re saving</p>
          <p className="text-xl font-bold text-blue-900 dark:text-blue-100">{readBack}</p>
        </div>
      )}

      {warning && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-400 px-4 py-3 flex gap-2" role="alert">
          <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-lg font-bold text-amber-900 dark:text-amber-200">{warning}</p>
            {armed && (
              <p className="text-base font-semibold text-amber-900 dark:text-amber-200 mt-1">
                Counted again and it&rsquo;s right? Tap &ldquo;Yes, it&rsquo;s right — enter stock&rdquo;.
              </p>
            )}
          </div>
        </div>
      )}

      {confirming && readBack ? (
        <div className="rounded-2xl border-4 border-blue-600 bg-blue-50 dark:bg-blue-950/40 p-4 space-y-3" role="alertdialog" aria-label="Confirm the stock check">
          <p className="text-2xl font-bold text-blue-950 dark:text-blue-50">
            You are updating the stock check for {ingredient.name} to <span className="whitespace-nowrap">{described?.entered}</span>. Please confirm.
          </p>
          <p className="text-base text-blue-900 dark:text-blue-200">This replaces the stock figure. Only confirm if you&rsquo;ve just counted it.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="min-h-[64px] rounded-xl bg-blue-600 text-white text-xl font-bold hover:bg-blue-700 inline-flex items-center justify-center gap-2 px-3 disabled:opacity-60"
            >
              {saving ? <><Loader2 className="w-6 h-6 animate-spin" /> Saving…</> : <><CheckCircle2 className="w-6 h-6" /> Yes, update it</>}
            </button>
            <button
              type="button"
              onClick={disregard}
              disabled={saving}
              className="min-h-[64px] rounded-xl border-2 border-blue-600 bg-background text-blue-900 dark:text-blue-100 text-lg font-bold hover:bg-blue-100/60 dark:hover:bg-blue-900/30 px-3"
            >
              No, disregard this change
            </button>
          </div>
        </div>
      ) : (
      <button
        type="button"
        onClick={save}
        disabled={!canSave}
        className={cn(
          "w-full min-h-[72px] rounded-2xl text-2xl font-bold transition-colors px-3 inline-flex items-center justify-center gap-2",
          !canSave
            ? "bg-blue-200 text-blue-500 cursor-not-allowed dark:bg-blue-900/30 dark:text-blue-500"
            : warning
              ? "bg-amber-600 text-white hover:bg-amber-700 active:scale-[0.98]"
              : "bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] shadow-md",
        )}
      >
        {saving
          ? <><Loader2 className="w-6 h-6 animate-spin" /> Saving…</>
          : warning && armed
            ? "Yes, it's right — enter stock"
            : <><CheckCircle2 className="w-6 h-6" /> Enter stock</>}
      </button>
      )}
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
        className="bg-card text-foreground border-2 border-blue-500 rounded-2xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-border/60">
          <Package className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-xl leading-tight">Stock check</h2>
            <p className="text-lg font-semibold text-blue-700 dark:text-blue-300 break-words">{ingredient.name}</p>
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
        <div className="px-5 py-5 overflow-y-auto">
          <StockCheckEntryForm
            {...props}
            onSaved={q => { onSaved?.(q); onClose(); }}
          />
        </div>
      </div>
    </div>
  );
}

/** The big "Record stock check for this item" button; opens the dialog.
 *  Once there's a count it shows it, and tapping again records a new one. */
export function StockCheckButton({ className, ...props }: CommonProps & { className?: string }) {
  const [open, setOpen] = useState(false);
  const label = useRecordedStockLabel();
  const recorded = props.currentNative != null;
  return (
    <>
      <StockCheckTrigger
        recordedLabel={recorded ? label(props.currentNative!, props.ingredient) : null}
        onClick={() => setOpen(true)}
        className={className}
      />
      {open && <StockCheckDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The trigger on its own, for hosts that manage the dialog themselves. */
export function StockCheckTrigger({ recordedLabel, onClick, className, compact = false }: {
  recordedLabel: string | null;
  onClick: () => void;
  className?: string;
  /** Smaller, for dense tables (the Orders page). */
  compact?: boolean;
}) {
  const recorded = recordedLabel != null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl font-bold inline-flex items-center gap-2 transition-colors active:scale-[0.98] text-left",
        compact ? "min-h-[40px] px-3 text-sm" : "min-h-[48px] px-4 text-base",
        recorded
          ? "bg-emerald-50 text-emerald-800 border-2 border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
          : "bg-blue-600 text-white hover:bg-blue-700 shadow",
        className,
      )}
    >
      <Package className={cn(compact ? "w-4 h-4" : "w-5 h-5", "flex-shrink-0")} />
      {recorded
        ? <span className={cn("leading-tight", compact && "whitespace-nowrap")}>{recordedLabel}<span className="block text-xs font-medium opacity-80">{compact ? "Record again" : "Record stock check again"}</span></span>
        : <span className={cn("leading-tight", compact && "whitespace-nowrap")}>{compact ? "Record stock check" : "Record stock check for this item"}</span>}
    </button>
  );
}
