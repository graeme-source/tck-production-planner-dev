/**
 * Stock checks at the point of prep, for stations whose own data doesn't
 * carry stock-check config (Graeme, 2026-09-10: white onions is attached to
 * a raw meat as a marinade, so the Raw Meat station showed it with no way
 * to record its count — and main prep never lists it because it only lives
 * on that station).
 *
 * Self-contained: give it the ingredient ids visible on the station and a
 * check date; it looks up which of them are stock-check-enabled and due
 * (daily, or weekly on today's real day — the real day, not the plan
 * date, same rule as the checklist scheduling fix), shows the same
 * blue check card as main prep, and saves to the same endpoint. Values
 * poll every 5s so two iPads agree. Renders nothing when nothing is due.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, Loader2, Check, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { guardedFetch } from "@/hooks/use-guarded-action";
import { toastDraftBlocked, nativeToPackCount, packsToNative, packNoun, packSizeHint } from "./prep-helpers";

interface StockCheckIngredient {
  id: number;
  name: string;
  unit: string;
  stockCheckEnabled: boolean;
  stockCheckFrequency: string;
  stockCheckDay: string | null;
  stockInPacks: boolean;
  packWeight: number | null;
}

export function StationStockChecks({ checkDate, isDraft = false, ingredientIds, stationLabel }: {
  /** The date stock checks are recorded against (the plan date, same as
   *  main prep's saves — one shared record per day across stations). */
  checkDate: string;
  isDraft?: boolean;
  /** Every ingredient id visible on this station, marinades included. */
  ingredientIds: number[];
  stationLabel: string;
}) {
  // Config comes from the ingredients list — the station payloads don't
  // carry stock-check fields for linked/marinade rows.
  const { data: allIngredients } = useQuery<StockCheckIngredient[]>({
    queryKey: ["ingredients-stock-check-config"],
    queryFn: async () => {
      const res = await fetch("/api/ingredients", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load ingredients");
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      return rows.map(r => ({
        id: Number(r.id),
        name: String(r.name ?? ""),
        unit: String(r.unit ?? "kg"),
        stockCheckEnabled: Boolean(r.stockCheckEnabled),
        stockCheckFrequency: String(r.stockCheckFrequency ?? "daily"),
        stockCheckDay: (r.stockCheckDay as string | null) ?? null,
        stockInPacks: Boolean(r.stockInPacks),
        packWeight: r.packWeight != null ? Number(r.packWeight) : null,
      }));
    },
    staleTime: 5 * 60_000,
  });

  const [values, setValues] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const dirtyIds = useRef<Set<number>>(new Set());

  const fetchSaved = useCallback(() => {
    fetch(`/api/production-plans/stock-checks?date=${checkDate}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (!d?.checks) return;
        const serverVals: Record<number, string> = {};
        const saved = new Set<number>();
        for (const c of d.checks) {
          if (c.quantity != null && c.quantity !== "") {
            serverVals[c.ingredientId] = String(parseFloat(c.quantity));
            saved.add(Number(c.ingredientId));
          }
        }
        setSavedIds(saved);
        setValues(prev => {
          const merged = { ...serverVals };
          for (const id of dirtyIds.current) if (id in prev) merged[id] = prev[id];
          return merged;
        });
      })
      .catch(() => { /* next poll */ });
  }, [checkDate]);

  useEffect(() => {
    fetchSaved();
    const t = setInterval(fetchSaved, 5000);
    return () => clearInterval(t);
  }, [fetchSaved]);

  // Weekly checks key on the REAL day, not the plan date (dough-room
  // Sunday/Thursday lesson).
  const todayDayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];
  const wanted = new Set(ingredientIds);
  const due = (allIngredients ?? []).filter(ing =>
    wanted.has(ing.id)
    && ing.stockCheckEnabled
    && (ing.stockCheckFrequency !== "weekly" || ing.stockCheckDay === todayDayName),
  );

  const save = async (ing: StockCheckIngredient) => {
    const val = values[ing.id];
    if (val === undefined || val === "") return;
    if (isDraft) { toastDraftBlocked(); return; }
    if (saving[ing.id]) return;
    setSaving(s => ({ ...s, [ing.id]: true }));
    try {
      await guardedFetch("/api/production-plans/stock-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId: ing.id, checkDate, quantity: Number(val) }),
      });
      dirtyIds.current.delete(ing.id);
      toast({ title: "Stock check saved" });
      fetchSaved();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Failed to save stock check", variant: "destructive" });
    } finally {
      setSaving(s => ({ ...s, [ing.id]: false }));
    }
  };

  if (due.length === 0) return null;

  return (
    <div className="bg-blue-50/70 dark:bg-blue-950/30 border-2 border-blue-400 dark:border-blue-600 rounded-xl p-4 shadow-md space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Package className="w-5 h-5 text-blue-600" />
        <p className="text-lg font-bold text-blue-800 dark:text-blue-200">Stock checks — {stationLabel}</p>
        <p className="text-sm text-blue-600 dark:text-blue-400">count what's left while you're stood at it.</p>
      </div>
      {due.map(ing => {
        const inPacks = ing.stockInPacks && (ing.packWeight ?? 0) > 0;
        const nativeStr = values[ing.id] ?? "";
        const display = inPacks && nativeStr !== ""
          ? String(nativeToPackCount(Number(nativeStr), ing.packWeight) ?? "")
          : nativeStr;
        const isSaved = savedIds.has(ing.id) && !dirtyIds.current.has(ing.id);
        const sizeHint = inPacks ? packSizeHint(ing.packWeight, ing.unit) : null;
        return (
          <div key={ing.id} className="flex items-center gap-2 flex-wrap">
            <span className={cn("font-semibold min-w-[10rem]", isSaved && "text-emerald-700 dark:text-emerald-400")}>{ing.name}</span>
            <input
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              placeholder={inPacks ? `Remaining ${packNoun(ing.unit, 0)}` : `Remaining ${ing.unit}`}
              className="flex-1 max-w-[150px] text-base border-2 border-blue-300 dark:border-blue-600 rounded-lg px-3 py-2 text-right bg-background focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
              value={display}
              onChange={e => {
                dirtyIds.current.add(ing.id);
                const v = e.target.value;
                if (v === "") { setValues(prev => ({ ...prev, [ing.id]: "" })); return; }
                const n = Number(v);
                setValues(prev => ({
                  ...prev,
                  [ing.id]: inPacks && Number.isFinite(n) ? String(packsToNative(n, ing.packWeight)) : v,
                }));
              }}
              onKeyDown={e => { if (e.key === "Enter") save(ing); }}
            />
            <span className="text-sm font-semibold">
              {inPacks ? packNoun(ing.unit, Number(display) || 0) : ing.unit}
              {sizeHint && <span className="block text-xs text-muted-foreground font-normal tabular-nums">({sizeHint})</span>}
            </span>
            <button
              onClick={() => save(ing)}
              disabled={!values[ing.id] || saving[ing.id]}
              className={cn(
                "px-4 py-2 rounded-lg text-base font-bold transition-all",
                values[ing.id]
                  ? "bg-blue-600 text-white hover:bg-blue-700 shadow active:scale-95"
                  : "bg-blue-200 text-blue-400 cursor-not-allowed",
              )}
            >
              {saving[ing.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : isSaved ? <Check className="w-4 h-4" /> : "Save"}
            </button>
            {isSaved && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> recorded
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
