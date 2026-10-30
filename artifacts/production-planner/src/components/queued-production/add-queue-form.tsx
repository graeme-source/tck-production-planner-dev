/**
 * Queue test batches for a production day. Graeme, 30 Oct 2026: "I'm
 * putting the production on Wednesday. I want that to automatically look
 * for the sales for next Friday and then tell me how many packs I need" —
 * so the form reads the delivery's sales (Friday for a Wednesday; change
 * the date if it's another), lists the recipes that sold first with their
 * suggestion (sold + 5 packs, whole batches), and ticking one starts it at
 * that suggestion. Every ticked recipe shows what its batches make.
 */
import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { useListRecipes, getListRecipesQueryKey } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { activeRecipes } from "@/lib/recipe-archive";
import { RecipeSwatch, useRecipeColourLookup } from "@/components/recipe-swatch";
import { makesLabel, queueBatches, useQueueSales } from "./api";

/** Starting batches for a recipe with no sales. */
const DEFAULT_BATCHES = 5;

interface RecipeOption { id: number; name: string; color?: string | null; portionsPerBatch?: number | string | null; packSize?: number | string | null; archivedAt?: string | null }

export function AddQueueForm({ initialDate, onSaved }: { initialDate: string; onSaved: () => void }) {
  const colourStyle = useRecipeColourLookup();
  const [date, setDate] = useState(initialDate);
  const [deliveryOverride, setDeliveryOverride] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const { data: recipes } = useListRecipes({ query: { queryKey: getListRecipesQueryKey() } });
  const sales = useQueueSales(date, deliveryOverride);
  const saleByRecipe = useMemo(() => new Map((sales.data?.lines ?? []).map(l => [l.recipeId, l])), [sales.data]);
  const deliveryDate = sales.data?.deliveryDate ?? null;

  const sorted = useMemo(() => {
    const list = (activeRecipes(recipes as RecipeOption[] | undefined, Object.keys(selected).map(Number)) as RecipeOption[])
      .sort((a, b) => (saleByRecipe.get(b.id)?.packsSold ?? 0) - (saleByRecipe.get(a.id)?.packsSold ?? 0) || a.name.localeCompare(b.name));
    const q = search.trim().toLowerCase();
    return q ? list.filter(r => r.name.toLowerCase().includes(q)) : list;
  }, [recipes, search, selected, saleByRecipe]);

  const toggle = (id: number) => setSelected(prev => {
    const next = { ...prev };
    if (next[id] != null) delete next[id]; else next[id] = saleByRecipe.get(id)?.batches || DEFAULT_BATCHES;
    return next;
  });
  const tickAllSold = () => setSelected(prev => {
    const next = { ...prev };
    for (const l of sales.data?.lines ?? []) next[l.recipeId] = l.batches;
    return next;
  });

  const selectedIds = Object.keys(selected).map(Number);
  const save = async () => {
    if (!date || selectedIds.length === 0) return;
    setSaving(true);
    try {
      await queueBatches(date, selectedIds.map(recipeId => ({ recipeId, batches: selected[recipeId] })));
      toast({ title: `Queued ${selectedIds.length} recipe${selectedIds.length === 1 ? "" : "s"} for ${format(parseISO(date), "EEEE d MMM")}` });
      setSelected({});
      onSaved();
    } catch (err) {
      toast({ title: "Couldn't queue production", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const soldCount = sales.data?.lines.length ?? 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-muted-foreground">Production date</span>
          <input type="date" value={date} onChange={e => { setDate(e.target.value); setDeliveryOverride(null); }}
            className="w-full h-12 px-3 border border-border rounded-xl text-base bg-background" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-muted-foreground">Sales for delivery on</span>
          <input type="date" value={deliveryOverride ?? deliveryDate ?? ""} disabled={!date} onChange={e => setDeliveryOverride(e.target.value || null)}
            className="w-full h-12 px-3 border border-border rounded-xl text-base bg-background disabled:opacity-50" />
        </label>
        <label className="block space-y-1 sm:col-span-2 lg:col-span-1">
          <span className="text-sm font-medium text-muted-foreground">Find recipes</span>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search recipes…"
            className="w-full h-12 px-3 border border-border rounded-xl text-base bg-background" />
        </label>
      </div>

      {date && (
        <div className="rounded-xl bg-secondary/50 px-3 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
          {sales.isLoading ? (
            <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Reading orders from Shopify…</span>
          ) : sales.isError ? (
            <span className="text-destructive">Couldn't read sales: {(sales.error as Error).message}</span>
          ) : deliveryDate ? (
            <>
              <span><span className="font-semibold">{soldCount === 0 ? "No orders yet" : `${soldCount} recipe${soldCount === 1 ? "" : "s"} sold`}</span> for {format(parseISO(deliveryDate), "EEE d MMM")}</span>
              {sales.data?.refreshError && <span className="text-amber-700 dark:text-amber-400">Shopify unreachable — older copy.</span>}
              {soldCount > 0 && (
                <button type="button" onClick={tickAllSold} className="px-3 py-1.5 rounded-lg border border-primary text-primary text-sm font-semibold hover:bg-primary/10 flex items-center gap-1">
                  <Sparkles className="w-4 h-4" /> Tick all that sold
                </button>
              )}
            </>
          ) : null}
        </div>
      )}

      <div className="max-h-[50dvh] overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-2">
        {sorted.map(r => {
          const sale = saleByRecipe.get(r.id);
          const on = selected[r.id] != null;
          const ppb = Number(r.portionsPerBatch) || 10;
          const size = Number(r.packSize) || 1;
          return (
            <div key={r.id} className={on ? "rounded-xl border-2 border-primary/50 p-2.5" : "rounded-xl border border-border p-2.5"}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={on} onChange={() => toggle(r.id)} className="w-5 h-5 rounded border-border flex-shrink-0" />
                <RecipeSwatch recipeId={r.id} color={r.color} fallback="transparent" className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-border" />
                <span className="text-base flex-1 min-w-0" style={r.color ? colourStyle(r.id, r.color, "text") : undefined}>{r.name}</span>
                {sale && <span className="text-sm font-semibold tabular-nums flex-shrink-0">{sale.packsSold} sold</span>}
              </label>
              {sale && !on && (
                <p className="pl-9 text-xs text-muted-foreground">{sale.batches} batches = {makesLabel(sale.batches, ppb, size)}</p>
              )}
              {on && (
                <div className="pl-9 mt-1.5 flex flex-wrap items-center gap-2">
                  <input type="number" inputMode="numeric" min={1} value={selected[r.id]}
                    onChange={e => setSelected(prev => ({ ...prev, [r.id]: Math.max(1, parseInt(e.target.value) || 1) }))}
                    aria-label={`Batches of ${r.name}`}
                    className="w-20 h-10 px-2 border border-border rounded-lg text-base text-center tabular-nums bg-background" />
                  <span className="text-sm text-muted-foreground">batches</span>
                  <span className="text-sm font-medium tabular-nums">= {makesLabel(selected[r.id], ppb, size)}</span>
                  {sale && sale.batches !== selected[r.id] && (
                    <button type="button" onClick={() => setSelected(prev => ({ ...prev, [r.id]: sale.batches }))}
                      className="px-2.5 py-1 rounded-lg border border-primary text-primary text-xs font-semibold hover:bg-primary/10">
                      Use {sale.batches}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button onClick={() => void save()} disabled={saving || !date || selectedIds.length === 0}
        className="min-h-12 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-base font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Queue {selectedIds.length > 0 ? selectedIds.length : ""} for production
      </button>
    </div>
  );
}
