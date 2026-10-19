/**
 * "Stock check is recorded in …" on the ingredient form (Graeme, 19 Oct
 * 2026). Objective F.
 *
 * The unit every stock check of this item asks for ("This stock check must
 * be recorded in KILOGRAMS"). "Automatic" = the default rule (@workspace/units
 * defaultStockCheckUnit): stock-in-packs items in packs, g/ml items in
 * grams, kg/l items in kilograms, count items in their own unit. Autosaves
 * with a visible save state on its own endpoint (PUT
 * /api/stock-check-units/:id), so it never waits for the dialog's Save.
 * Options follow the SAVED unit and pack size — change those and save the
 * ingredient first.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  defaultStockCheckUnit,
  isStockCheckUnit,
  stockCheckPackLabel,
  stockCheckUnitName,
  type StockCheckUnit,
} from "@workspace/units";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { stockCheckUnitsQueryKey, useStockCheckUnits } from "@/pages/station/shared/stock-check-entry";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function saveUnit(id: number, stockCheckUnit: StockCheckUnit | null) {
  const res = await fetch(`${BASE}/api/stock-check-units/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stockCheckUnit }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(res.status === 403 ? "Managers only" : body.error ?? `Couldn't save (${res.status})`);
  }
}

export function StockCheckUnitField({ ingredientId }: { ingredientId: number }) {
  const qc = useQueryClient();
  const q = useStockCheckUnits();
  const row = q.data?.[String(ingredientId)];
  const [choice, setChoice] = useState<StockCheckUnit | "auto">("auto");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded && row) {
      setChoice(isStockCheckUnit(row.stockCheckUnit) ? row.stockCheckUnit : "auto");
      setLoaded(true);
    }
  }, [row, loaded]);

  const auto = useAutosave(async (value: StockCheckUnit | null) => {
    await saveUnit(ingredientId, value);
    await qc.invalidateQueries({ queryKey: stockCheckUnitsQueryKey });
  }, 0);

  if (q.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading stock-check unit…</div>;
  }
  if (!row) {
    return <p className="text-sm text-destructive">Couldn&rsquo;t load the stock-check unit. Close and reopen to try again.</p>;
  }

  const item = { unit: row.unit, packWeight: row.packWeight, stockInPacks: row.stockInPacks };
  const def = defaultStockCheckUnit(item);
  const describe = (u: StockCheckUnit) => {
    const pack = stockCheckPackLabel(u, item);
    return `${stockCheckUnitName(u, item)}${pack ? ` (${pack})` : ""}`;
  };
  const pick = (v: StockCheckUnit | "auto") => {
    setChoice(v);
    auto.schedule(v === "auto" ? null : v);
  };
  const options: Array<{ value: StockCheckUnit | "auto"; label: string }> = [
    { value: "auto", label: `Automatic — ${describe(def)}` },
    ...row.options.map(u => ({ value: u, label: describe(u) })),
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-medium">Stock check is recorded in</span>
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Stock check is recorded in">
        {options.map(o => {
          const on = choice === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pick(o.value)}
              className={cn(
                "min-h-11 px-3 py-2 rounded-xl border-2 text-sm font-semibold text-left transition-colors",
                on ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/60",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Every stock check of this item says &ldquo;This stock check must be recorded in {stockCheckUnitName(choice === "auto" ? def : choice, item).toUpperCase()}&rdquo; and takes one number. It&rsquo;s still stored in {row.unit}.
      </p>
    </div>
  );
}
