/**
 * "Pack name" on the ingredient form (fix-queue #327, Jane Miles; Graeme
 * approved 22 Oct 2026). Objective C.
 *
 * What one supplier pack of this item is called — box, roll, bag, tub,
 * case … Used wherever the word "pack" shows: stock checks ("Count BOXES
 * (1 box = 12 kg)"), goods-in, Orders and kanban. "Pack" (the default)
 * keeps the old wording. Display only: stock maths is unchanged.
 *
 * Autosaves with a visible save state on PUT /api/stock-check-units/:id
 * (the endpoint the stock-check unit already uses), so it never waits for
 * the dialog's Save.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { PACK_NAMES, isPackName, pluralPackName, type PackName } from "@workspace/units";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { stockCheckUnitsQueryKey, useStockCheckUnits } from "@/pages/station/shared/stock-check-entry";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function savePackName(id: number, packName: PackName | null) {
  const res = await fetch(`${BASE}/api/stock-check-units/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packName }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(res.status === 403 ? "Managers only" : body.error ?? `Couldn't save (${res.status})`);
  }
}

export function PackNameField({ ingredientId }: { ingredientId: number }) {
  const qc = useQueryClient();
  const q = useStockCheckUnits();
  const row = q.data?.[String(ingredientId)];
  const [choice, setChoice] = useState<PackName | "default">("default");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded && row) {
      setChoice(isPackName(row.packName) ? row.packName : "default");
      setLoaded(true);
    }
  }, [row, loaded]);

  const auto = useAutosave(async (value: PackName | null) => {
    await savePackName(ingredientId, value);
    await qc.invalidateQueries({ queryKey: stockCheckUnitsQueryKey });
    await qc.invalidateQueries({ queryKey: ["order-calculate"] });
  }, 0);

  if (q.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading pack name…</div>;
  }
  if (!row) {
    return <p className="text-sm text-destructive">Couldn&rsquo;t load the pack name. Close and reopen to try again.</p>;
  }

  const liquid = ["ml", "l"].includes(row.unit.toLowerCase().trim());
  const pick = (v: PackName | "default") => {
    setChoice(v);
    auto.schedule(v === "default" ? null : v);
  };
  const options: Array<{ value: PackName | "default"; label: string }> = [
    { value: "default", label: liquid ? "Bottle (default)" : "Pack (default)" },
    ...PACK_NAMES.filter(n => n !== "pack").map(n => ({ value: n, label: n[0]!.toUpperCase() + n.slice(1) })),
  ];
  const plural = choice === "default" ? (liquid ? "bottles" : "packs") : pluralPackName(choice);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-medium">Pack name — what one pack is called</span>
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Pack name">
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
                "min-h-11 px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-colors",
                on ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/60",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Stock checks, goods-in, orders and kanban say &ldquo;{plural}&rdquo; for this item. The pack size and stock maths don&rsquo;t change.
      </p>
    </div>
  );
}
