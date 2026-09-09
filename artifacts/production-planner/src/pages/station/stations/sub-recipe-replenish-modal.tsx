/**
 * Replenish one sub-recipe in a popup, without leaving the screen you're on.
 *
 * Built for the prep stations (Graeme, 2026-09-08): a rub or mix named on a
 * raw-meat row ("Philly beef rub" under diced beef) is now a link, and this
 * modal is where it lands — the standalone Replenish flow jumped straight to
 * that sub-recipe, so the operator picks mixes, sees the scaled recipe,
 * ticks it off and is back on the prep list in a few taps.
 *
 * The make-flow itself is lazy-imported from prep-bases-station. That is
 * deliberate, not decoration: prep-bases-station statically imports from
 * main-prep-station, and main-prep-station mounts this modal — a static
 * import here would close that loop into a module cycle. Lazy keeps the
 * graph acyclic; the one-render fallback spinner is invisible in practice.
 */
import React, { Suspense, useEffect } from "react";
import { useListSubRecipes } from "@workspace/api-client-react";
import type { SubRecipe } from "@workspace/api-client-react";
import { FlaskConical, Loader2, X } from "lucide-react";

const SubRecipeMakeFlow = React.lazy(() =>
  import("./prep-bases-station").then(m => ({ default: m.SubRecipeMakeFlow })),
);

export interface ReplenishTarget {
  subRecipeId: number;
  name: string;
}

export function SubRecipeReplenishModal({ target, onClose }: {
  target: ReplenishTarget;
  onClose: () => void;
}) {
  const { data } = useListSubRecipes();
  const allSubRecipes = (data ?? []) as SubRecipe[];

  // The prep screens live on an iPad — let the hardware back-ish Escape work
  // on the desks that do have a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const spinner = (
    <div className="py-16 flex justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-2xl p-5 mt-8 mb-8 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <FlaskConical className="w-6 h-6 text-primary flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="font-bold text-xl leading-tight truncate">Replenish {target.name}</h2>
              <p className="text-sm text-muted-foreground">Make it now — the prep list stays where you left it.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {allSubRecipes.length === 0 ? spinner : (
          <Suspense fallback={spinner}>
            <SubRecipeMakeFlow
              mode="standalone"
              planRequirements={[]}
              allSubRecipes={allSubRecipes}
              initialSubRecipeId={target.subRecipeId}
              onClose={onClose}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
