/**
 * "Used in" — which recipes use an ingredient (Objective C). One copy, used
 * by the Ingredients list's Used-in count and the Orders page's Pulled
 * Kanbans list (Graeme, 15 Oct 2026: "be able to click on it and see what
 * recipes it's used in"). The count comes with the list rows
 * (usedInRecipes / usedInSubRecipes, computed once on the server in
 * lib/ingredient-usage-counts.ts); the names come from
 * GET /api/ingredients/:id/usage, which also lists recipes that get the
 * ingredient through a sub-recipe. Every recipe name links to its recipe.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChefHat, ClipboardList, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usedInLabel } from "@/lib/used-in-label";

interface UsageData {
  recipes: Array<{ id: number; name: string }>;
  subRecipes: Array<{ id: number; name: string }>;
  viaSubRecipes: Array<{ id: number; name: string; viaSubRecipe: { id: number; name: string } }>;
}


export function IngredientUsageDialog({ id, name, onClose }: { id: number; name: string; onClose: () => void }) {
  const { data, error, isLoading } = useQuery<UsageData>({
    queryKey: ["ingredient-usage", id],
    queryFn: async () => {
      const res = await fetch(`/api/ingredients/${id}/usage`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load usage (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });

  // A Radix dialog, so it stacks properly on top of another dialog (the
  // Pulled Kanbans list) without closing it. Built-in X + Escape close it.
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg w-[95vw] max-h-[92dvh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-5 py-4 pr-12 border-b border-border text-left">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Used in</p>
          <DialogTitle className="text-lg font-semibold truncate">{name}</DialogTitle>
          <p className="text-xs text-muted-foreground">Recipes open in a new tab, so this list stays put.</p>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Failed to load"}</p>}
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}
          {data && (
            <>
              {data.recipes.length === 0 && data.subRecipes.length === 0 && (
                <p className="text-sm text-muted-foreground">Not currently used in any recipe or sub-recipe.</p>
              )}
              {data.recipes.length > 0 && (
                <section>
                  <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
                    <ChefHat className="w-3.5 h-3.5" /> Recipes ({data.recipes.length})
                  </h4>
                  <ul className="space-y-1">
                    {data.recipes.map(r => (
                      <li key={r.id}>
                        <a href={`/recipes?edit=${r.id}`} target="_blank" rel="noopener" className="block text-base py-2 px-2 rounded text-primary font-medium hover:bg-secondary/40 hover:underline">
                          {r.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {data.subRecipes.length > 0 && (
                <section>
                  <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
                    <ClipboardList className="w-3.5 h-3.5" /> Via sub-recipes ({data.subRecipes.length})
                  </h4>
                  <ul className="space-y-2">
                    {data.subRecipes.map(s => {
                      const usedBy = data.viaSubRecipes.filter(v => v.viaSubRecipe.id === s.id);
                      return (
                        <li key={s.id} className="py-1.5 px-2 rounded hover:bg-secondary/40">
                          <a href="/sub-recipes" target="_blank" rel="noopener" className="text-base font-medium hover:underline">{s.name}</a>
                          {usedBy.length > 0 ? (
                            <div className="text-sm text-muted-foreground mt-0.5 flex flex-wrap gap-x-1">
                              <span>used in:</span>
                              {usedBy.map((v, i) => (
                                <span key={v.id}>
                                  <a href={`/recipes?edit=${v.id}`} target="_blank" rel="noopener" className="text-primary hover:underline">{v.name}</a>
                                  {i < usedBy.length - 1 ? "," : ""}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground mt-0.5">not in any recipe</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The small "Used in N recipes" link that opens the dialog. Renders a
 *  quiet "Not used in any recipe" when both counts are zero. */
export function UsedInLink({ id, name, recipes, subRecipes, className }: {
  id: number;
  name: string;
  recipes: number;
  subRecipes: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (recipes + subRecipes === 0) {
    return <span className={cn("text-xs text-muted-foreground", className)}>Not used in any recipe</span>;
  }
  return (
    <>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        className={cn("text-sm text-primary font-medium underline underline-offset-2 hover:no-underline py-1", className)}
      >
        Used in {usedInLabel(recipes, subRecipes)}
      </button>
      {open && <IngredientUsageDialog id={id} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}
