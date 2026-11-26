/**
 * "Kanban in single items" on the ingredient form (Graeme, 26 Nov 2026 —
 * pepperoni comes in boxes of 10 bags, and once a box is in, the bags go
 * loose into the two-bin system). Switched on, the card says "Pull when 15
 * bags left" and the trigger is typed in bags, while the order amount and
 * the Orders page still count boxes ("order 3 boxes — 30 kg").
 *
 * The switch, item name and count autosave on their own endpoint
 * (PUT /api/ingredients/:id/kanban-items). The trigger itself is still the
 * dialog's own field, kept in packs (@workspace/units kanbanSingleItems), so
 * ordering and stock-left maths don't change. Objective C.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PACK_NAMES, itemWord, packNoun, pluralPackName, type PackName } from "@workspace/units";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface KanbanItemsSetting { itemName: PackName | null; perPack: number | null }

export const kanbanItemsKey = (id: number) => ["ingredient-kanban-items", id] as const;

export function useKanbanItems(ingredientId: number | null | undefined) {
  return useQuery<KanbanItemsSetting>({
    queryKey: kanbanItemsKey(ingredientId ?? 0),
    enabled: !!ingredientId,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/ingredients/${ingredientId}/kanban-items`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}

const ITEM_NAMES = PACK_NAMES.filter(n => n !== "pack" && n !== "box" && n !== "case" && n !== "carton" && n !== "sack");

export function KanbanSingleItemsField({ ingredientId, packName }: { ingredientId: number; packName: string | null }) {
  const qc = useQueryClient();
  const q = useKanbanItems(ingredientId);
  const [on, setOn] = useState(false);
  const [name, setName] = useState<PackName>("bag");
  const [perText, setPerText] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (q.data && !loaded) {
      setOn(q.data.perPack != null);
      if (q.data.itemName) setName(q.data.itemName);
      setPerText(q.data.perPack != null ? String(q.data.perPack) : "");
      setLoaded(true);
    }
  }, [q.data, loaded]);

  const save = useMutation({
    mutationFn: async (body: KanbanItemsSetting) => {
      const res = await fetch(`${BASE}/api/ingredients/${ingredientId}/kanban-items`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 403 ? "Managers only" : (out as { error?: string }).error ?? `HTTP ${res.status}`);
      return out as KanbanItemsSetting;
    },
    onSuccess: (data) => qc.setQueryData(kanbanItemsKey(ingredientId), data),
  });
  const auto = useAutosave((body: KanbanItemsSetting) => save.mutateAsync(body), 600);

  const pack = packNoun("pack", 1, packName);
  const per = Number(perText);
  const perOk = Number.isInteger(per) && per >= 2;
  const push = (next: { on: boolean; name: PackName; perText: string }) => {
    const n = Number(next.perText);
    if (!next.on) auto.schedule({ itemName: null, perPack: null });
    else if (Number.isInteger(n) && n >= 2) auto.schedule({ itemName: next.name, perPack: n });
  };

  return (
    <div className="rounded-xl border border-border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 w-4 h-4"
            checked={on}
            disabled={q.isLoading}
            onChange={e => { setOn(e.target.checked); push({ on: e.target.checked, name, perText }); }}
          />
          <span>
            <span className="font-semibold">Kanban in single items</span>
            <span className="block text-xs text-muted-foreground">
              The card counts what's loose on the shelf (bags, tubs…); the order still counts {pluralPackName(isPack(pack) ? pack : "pack")}.
            </span>
          </span>
        </label>
        <SaveChip state={auto.state} error={auto.error} onRetry={auto.flush} />
      </div>
      {on && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What one item is called">
            {ITEM_NAMES.map(n => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={name === n}
                onClick={() => { setName(n); push({ on, name: n, perText }); }}
                className={cn(
                  "min-h-11 px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-colors",
                  name === n ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/60",
                )}
              >
                {n[0]!.toUpperCase() + n.slice(1)}
              </button>
            ))}
          </div>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{pluralPackName(name)[0]!.toUpperCase() + pluralPackName(name).slice(1)} in one {pack}</span>
            <input
              type="number"
              min={2}
              step={1}
              inputMode="numeric"
              value={perText}
              onChange={e => { setPerText(e.target.value); push({ on, name, perText: e.target.value }); }}
              className="w-24 h-11 rounded-lg border border-border bg-background px-3 text-base tabular-nums"
              placeholder="e.g. 10"
            />
          </label>
          {!perOk && <p className="text-xs text-amber-700 dark:text-amber-400">Say how many {pluralPackName(name)} come in one {pack} (2 or more) — until then the card stays in {pluralPackName(isPack(pack) ? pack : "pack")}.</p>}
          {perOk && <p className="text-xs text-muted-foreground">1 {pack} = {per} {itemWord(name, per)}. The trigger above is typed in {pluralPackName(name)}.</p>}
        </div>
      )}
    </div>
  );
}

function isPack(v: string): v is PackName {
  return (PACK_NAMES as readonly string[]).includes(v);
}
