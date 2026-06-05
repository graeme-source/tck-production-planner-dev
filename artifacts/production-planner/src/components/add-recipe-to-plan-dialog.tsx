import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useListRecipes, getListRecipesQueryKey } from "@workspace/api-client-react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";

/**
 * Adds a recipe to an existing production plan in place — no reset, no lost
 * progress. Backed by POST /api/production-plans/:id/add-recipe. If the recipe
 * is already on the plan, its batch target is topped up.
 */
export function AddRecipeToPlanDialog({
  planId, open, onClose, onAdded, existingRecipeIds,
}: {
  planId: number;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  existingRecipeIds: number[];
}) {
  const { data: recipes } = useListRecipes({ query: { queryKey: getListRecipesQueryKey(), enabled: open } });
  const [recipeId, setRecipeId] = useState<string>("");
  const [batches, setBatches] = useState<string>("1");
  const [saving, setSaving] = useState(false);

  const existing = new Set(existingRecipeIds);
  const sorted = useMemo(() => {
    return ((recipes as Array<{ id: number; name: string }> | undefined) ?? [])
      .slice()
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [recipes]);

  const n = Number(batches);
  const valid = !!recipeId && Number.isInteger(n) && n >= 1;

  const handleAdd = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/production-plans/${planId}/add-recipe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId: Number(recipeId), batches: n }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Couldn't add recipe", description: body.error ?? "Failed to add.", variant: "destructive" });
        return;
      }
      toast({
        title: body.toppedUp ? `Topped up ${body.recipeName}` : `Added ${body.recipeName}`,
        description: `Now ${body.batchesTarget} batch${body.batchesTarget === 1 ? "" : "es"} on the plan.`,
      });
      onAdded();
      onClose();
      setRecipeId("");
      setBatches("1");
    } catch (err) {
      toast({ title: "Add failed", description: err instanceof Error ? err.message : "Network error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" /> Add a recipe to this plan
          </DialogTitle>
          <DialogDescription>
            Adds the recipe in place — no reset, no lost progress. If it's already on the plan, the batches are added to its target.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Recipe</label>
            <select
              value={recipeId}
              onChange={e => setRecipeId(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-border rounded-lg text-sm bg-background"
            >
              <option value="">Select a recipe…</option>
              {sorted.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}{existing.has(r.id) ? "  (already on plan — will top up)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">Batches</label>
            <input
              type="number" min="1" step="1"
              value={batches}
              onChange={e => setBatches(e.target.value)}
              className="mt-1 block w-28 px-3 py-2 border border-border rounded-lg text-sm text-right"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-secondary">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={saving || !valid}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add to plan
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
