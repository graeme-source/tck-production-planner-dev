/**
 * Connected Inventory on the ingredient form (Graeme, 10 Nov 2026).
 * Objective C. A product fridge item (Sauce Shop bottles, Cakehead bakes)
 * reads its stock from Shopify; whenever an order goes to its supplier, the
 * Orders page tops it up to the maximum here. Each change saves straight
 * away with a visible state.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Refrigerator } from "lucide-react";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type View = {
  id: number;
  connectedInventory: boolean;
  maxStockUnits: number | null;
  linkedToShopify: boolean;
  unitsPerPack: number;
  onHandUnits: number | null;
};
type Patch = { connectedInventory?: boolean; maxStockUnits?: number | null };

export function ConnectedInventoryFields({ ingredientId }: { ingredientId: number | null }) {
  if (ingredientId == null) return null;
  return <Fields ingredientId={ingredientId} />;
}

function Fields({ ingredientId }: { ingredientId: number }) {
  const qc = useQueryClient();
  const key = ["connected-inventory", ingredientId];
  const view = useQuery<View>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/ingredients/${ingredientId}/connected-inventory`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
  const save = useMutation({
    mutationFn: async (patch: Patch) => {
      const res = await fetch(`${BASE}/api/ingredients/${ingredientId}/connected-inventory`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      return body as View;
    },
    onSuccess: data => qc.setQueryData(key, data),
  });
  const auto = useAutosave((patch: Patch) => save.mutateAsync(patch));
  // Both fields go every time, so a quick tick then type can't drop one.
  const parseMax = (raw: string): number | null => {
    const n = Number(raw);
    return raw.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
  };
  const [on, setOn] = useState(false);
  const [max, setMax] = useState("");
  useEffect(() => {
    if (!view.data) return;
    setOn(view.data.connectedInventory);
    setMax(view.data.maxStockUnits != null ? String(view.data.maxStockUnits) : "");
  }, [view.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view.data) return null;
  const v = view.data;
  if (!v.linkedToShopify) {
    return (
      <p className="text-xs text-muted-foreground">
        Product fridge item: link it to its Shopify product and save, then it can be topped up from Shopify&rsquo;s stock.
      </p>
    );
  }
  const maxNum = Number(max);
  const shortBy = on && maxNum > 0 && v.onHandUnits != null ? Math.max(0, maxNum - Math.max(0, v.onHandUnits)) : null;
  const packs = shortBy != null ? Math.floor(shortBy / v.unitsPerPack + 1e-9) : null;

  return (
    <div className="rounded-xl border border-border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Refrigerator className="w-4 h-4 text-primary" /> Product fridge item
        </p>
        <SaveChip state={auto.state} error={auto.error} onRetry={auto.flush} />
      </div>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 w-4 h-4"
          checked={on}
          onChange={e => { setOn(e.target.checked); auto.schedule({ connectedInventory: e.target.checked, maxStockUnits: parseMax(max) }); void auto.flush(); }}
        />
        <span>
          Connected Inventory
          <span className="block text-xs text-muted-foreground">
            Whenever we order from this supplier, top this up to the maximum from Shopify&rsquo;s stock.
          </span>
        </span>
      </label>
      {on && (
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <label htmlFor={`ci-max-${ingredientId}`} className="text-muted-foreground">Most we hold</label>
          <input
            id={`ci-max-${ingredientId}`}
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={max}
            onChange={e => {
              setMax(e.target.value);
              auto.schedule({ connectedInventory: on, maxStockUnits: parseMax(e.target.value) });
            }}
            onBlur={() => void auto.flush()}
            className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-right"
            placeholder="e.g. 48"
          />
          <span className="text-muted-foreground">on the shelf</span>
        </div>
      )}
      {on && (
        <p className="text-xs text-muted-foreground">
          Shopify has <span className="font-semibold text-foreground">{v.onHandUnits ?? "—"}</span> now
          {packs != null && maxNum > 0 && <> · an order today would add <span className="font-semibold text-foreground">{packs} {packs === 1 ? "pack" : "packs"}</span> ({v.unitsPerPack} each)</>}
          {!(maxNum > 0) && <> · set the most we hold to start topping up</>}
        </p>
      )}
    </div>
  );
}
