/**
 * The raw meat portioning settings on the ingredient form (Graeme, 9 Nov 2026,
 * Fix queue #396). Each change saves straight away with a visible state.
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import type { MeatContainer, MeatPortioning } from "@/lib/meat-portioning";
import { useMeatPortioning, useSaveMeatPortioning } from "./api";

type Patch = Partial<Omit<MeatPortioning, "id">>;

export function MeatPortioningFields({ ingredientId }: { ingredientId: number | null }) {
  if (ingredientId == null) {
    return <p className="text-xs text-muted-foreground">Save the ingredient first, then set whether it goes in trays or bags.</p>;
  }
  return <Fields ingredientId={ingredientId} />;
}

function Fields({ ingredientId }: { ingredientId: number }) {
  const portioning = useMeatPortioning();
  const save = useSaveMeatPortioning(ingredientId);
  const current = portioning.of(ingredientId);
  const [draft, setDraft] = useState(current);
  useEffect(() => { if (portioning.data) setDraft(portioning.of(ingredientId)); }, [portioning.data, ingredientId]);
  const auto = useAutosave((patch: Patch) => save.mutateAsync(patch), 0);
  const set = (patch: Patch) => {
    setDraft(d => ({ ...d, ...patch }));
    auto.schedule(patch);
  };

  const choice = (value: MeatContainer, label: string) => (
    <button
      type="button"
      onClick={() => set({ container: value })}
      className={cn(
        "px-3 py-2 rounded-lg border text-sm font-medium min-h-10",
        draft.container === value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary/60",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-xl border border-border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Raw Meat station</p>
        <SaveChip state={auto.state} error={auto.error} onRetry={auto.flush} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Goes in</span>
        {choice("tray", "Trays")}
        {choice("bag", "Bags")}
      </div>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="mt-0.5 w-4 h-4" checked={draft.breakdown} onChange={e => set({ breakdown: e.target.checked })} />
        <span>
          Split into {draft.container === "bag" ? "bags" : "trays"}
          <span className="block text-xs text-muted-foreground">
            Off: the station shows the total meat, rub and sauce, with one tick for the lot.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="mt-0.5 w-4 h-4" checked={draft.countsTowardSlowMeat} onChange={e => set({ countsTowardSlowMeat: e.target.checked })} />
        <span>
          Counts toward the slow-meat oven limit
          <span className="block text-xs text-muted-foreground">Only matters for meats with a long cook time. Untick if it cooks at a different time.</span>
        </span>
      </label>
    </div>
  );
}
