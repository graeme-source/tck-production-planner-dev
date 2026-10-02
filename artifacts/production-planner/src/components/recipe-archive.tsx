/**
 * Recipe archive — the UI half (Graeme, 2026-10-02; migration 0141).
 *
 *   ArchiveRecipeDialog   "Archive 'X'?" confirm with the plan / core-menu
 *                         heads-ups from archive-check; Undo toast after.
 *   ArchivedRecipesPanel  the Archived view on the Recipes page: big greyed
 *                         cards, "Archived 2 Oct by Graeme", big Restore.
 *   useRecipeArchiveActions  archive / restore mutations (React Query) that
 *                         refresh every recipe list and picker afterwards.
 *
 * Pure rules (filtering, labels, warning wording) live in
 * lib/recipe-archive.ts and are unit-tested there.
 */
import { useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getListRecipesQueryKey } from "@workspace/api-client-react";
import { Archive, ArchiveRestore, AlertTriangle, Loader2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { archivedLabel, archiveWarnings } from "@/lib/recipe-archive";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ArchiveCheckResponse = {
  recipe: { id: number; name: string; archivedAt: string | null; isCoreMenu: boolean; isCurrentSpecial: boolean };
  upcomingPlans: Array<{ planId: number; planDate: string; name: string; status: string }>;
  today: string;
};

async function postJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

/** Archive / restore, refreshing the recipe list and every picker that
 *  reads its own recipe-options endpoint. */
export function useRecipeArchiveActions() {
  const queryClient = useQueryClient();
  const refresh = (id: number) => {
    queryClient.invalidateQueries({ queryKey: getListRecipesQueryKey() });
    queryClient.invalidateQueries({ queryKey: [`/api/recipes/${id}`] });
    queryClient.invalidateQueries({ queryKey: ["recipe-archive-check", id] });
    queryClient.invalidateQueries({ queryKey: ["defects", "recipe-options"] });
    queryClient.invalidateQueries({ queryKey: ["test-boxes", "recipe-options"] });
    queryClient.invalidateQueries({ queryKey: ["survey-recipe-options"] });
    queryClient.invalidateQueries({ queryKey: ["case-recipe-limits"] });
  };
  const archive = useMutation({
    mutationFn: (id: number) => postJson(`/api/recipes/${id}/archive`),
    onSuccess: (_d, id) => refresh(id),
  });
  const restore = useMutation({
    mutationFn: (id: number) => postJson(`/api/recipes/${id}/restore`),
    onSuccess: (_d, id) => refresh(id),
  });

  async function restoreWithToast(recipe: { id: number; name: string }) {
    try {
      await restore.mutateAsync(recipe.id);
      toast({ title: `Restored "${recipe.name}"`, description: "It's back in the Recipes list and every picker." });
    } catch (err) {
      toast({ title: "Couldn't restore it", description: err instanceof Error ? err.message : "Try again in a moment.", variant: "destructive" });
    }
  }

  async function archiveWithToast(recipe: { id: number; name: string }): Promise<boolean> {
    try {
      await archive.mutateAsync(recipe.id);
      toast({
        title: `Archived "${recipe.name}"`,
        description: "Nothing was deleted — find it under Archived to restore it.",
        action: <ToastAction altText="Undo" onClick={() => void restoreWithToast(recipe)}>Undo</ToastAction>,
      });
      return true;
    } catch (err) {
      toast({ title: "Couldn't archive it", description: err instanceof Error ? err.message : "Try again in a moment.", variant: "destructive" });
      return false;
    }
  }

  return { archive, restore, archiveWithToast, restoreWithToast };
}

export function ArchiveRecipeDialog({ recipe, onClose, onArchived }: {
  recipe: { id: number; name: string } | null;
  onClose: () => void;
  onArchived?: () => void;
}) {
  const open = recipe != null;
  // Keep the last recipe's name on screen while the dialog animates closed.
  const lastRef = useRef(recipe);
  if (recipe) lastRef.current = recipe;
  const shown = recipe ?? lastRef.current;
  const { archive, archiveWithToast } = useRecipeArchiveActions();
  const check = useQuery<ArchiveCheckResponse>({
    queryKey: ["recipe-archive-check", recipe?.id],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/recipes/${recipe!.id}/archive-check`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
  const warnings = check.data
    ? archiveWarnings({ upcomingPlans: check.data.upcomingPlans, isCoreMenu: check.data.recipe.isCoreMenu, isCurrentSpecial: check.data.recipe.isCurrentSpecial }, check.data.today)
    : [];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[92dvh] overflow-y-auto bg-card border-border rounded-2xl p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl pr-6">Archive "{shown?.name}"?</DialogTitle>
          <DialogDescription className="text-base text-foreground/80 pt-1">
            It disappears from lists and pickers but nothing is deleted — restore any time from Archived.
          </DialogDescription>
        </DialogHeader>

        {check.isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Checking plans…</p>
        )}
        {check.isError && (
          <p className="text-sm text-muted-foreground">Couldn't check upcoming plans just now — archiving is still safe; anything already planned is still made.</p>
        )}
        {warnings.length > 0 && (
          <ul className="space-y-2">
            {warnings.map(w => (
              <li key={w} className="flex gap-3 rounded-xl border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-base text-amber-950 dark:text-amber-100">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-12 rounded-xl border border-border px-4 text-base font-medium hover:bg-secondary/60 transition-colors"
          >
            Keep it
          </button>
          <button
            type="button"
            disabled={archive.isPending || !recipe}
            onClick={async () => {
              if (!recipe) return;
              const ok = await archiveWithToast(recipe);
              if (ok) { onClose(); onArchived?.(); }
            }}
            className="flex-1 min-h-12 rounded-xl bg-foreground text-background px-4 text-base font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {archive.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Archive className="w-5 h-5" />}
            Archive recipe
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Foot of Edit Recipe (managers/admins): Archive, or — when already
 *  archived — who archived it and a big Restore. */
export function RecipeArchiveFooter({ recipe, onArchive }: {
  recipe: { id: number; name: string; archivedAt: string | null; archivedByName: string | null };
  onArchive: () => void;
}) {
  const { restore, restoreWithToast } = useRecipeArchiveActions();
  if (recipe.archivedAt) {
    return (
      <div className="mt-6 rounded-2xl border-2 border-dashed border-border bg-muted/40 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <p className="text-base font-semibold">{archivedLabel(recipe.archivedAt, recipe.archivedByName)}</p>
          <p className="text-sm text-muted-foreground">Hidden from the Recipes list and every picker. Nothing was deleted.</p>
        </div>
        <button
          type="button"
          disabled={restore.isPending}
          onClick={() => void restoreWithToast(recipe)}
          className="min-h-12 rounded-xl bg-primary text-primary-foreground px-5 text-base font-semibold inline-flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {restore.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArchiveRestore className="w-5 h-5" />}
          Restore
        </button>
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-2xl border border-border p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1">
        <p className="text-base font-semibold">No longer making this?</p>
        <p className="text-sm text-muted-foreground">Archive it to take it out of the list and the pickers. Nothing is deleted — restore any time.</p>
      </div>
      <button
        type="button"
        onClick={onArchive}
        className="min-h-12 rounded-xl border border-border px-5 text-base font-medium inline-flex items-center justify-center gap-2 hover:bg-secondary/60 transition-colors"
      >
        <Archive className="w-5 h-5" /> Archive recipe
      </button>
    </div>
  );
}

export type ArchivedRecipeRow = {
  id: number; name: string; category?: string | null; color?: string | null;
  archivedAt?: string | null; archivedByName?: string | null;
};

export function ArchivedRecipesPanel({ recipes, canManage, onOpen }: {
  recipes: ArchivedRecipeRow[];
  canManage: boolean;
  onOpen: (id: number) => void;
}) {
  const { restore, restoreWithToast } = useRecipeArchiveActions();

  if (recipes.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground rounded-2xl border-2 border-dashed border-border">
        <Archive className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-lg font-medium">Nothing archived</p>
        <p className="text-sm mt-1">Archive a recipe you no longer make and it moves here, out of the way.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {recipes.map(r => {
        const busy = restore.isPending && restore.variables === r.id;
        return (
          <div key={r.id} className="rounded-2xl border-2 border-dashed border-border bg-muted/40 p-5 flex flex-col gap-3" data-testid="archived-recipe-card">
            <div className="min-w-0 opacity-70">
              <p className="text-lg font-semibold leading-tight flex items-center gap-2">
                {r.color && <span className="w-3 h-3 rounded-full shrink-0 grayscale" style={{ backgroundColor: r.color }} />}
                <span className="truncate">{r.name}</span>
              </p>
              {r.category && <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">{r.category}</p>}
            </div>
            <p className="inline-flex items-center gap-1.5 self-start rounded-full bg-secondary px-3 py-1 text-sm text-muted-foreground">
              <Archive className="w-3.5 h-3.5" /> {archivedLabel(r.archivedAt, r.archivedByName)}
            </p>
            <div className="flex gap-2 mt-auto pt-1">
              {canManage && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void restoreWithToast(r)}
                  className="flex-1 min-h-12 rounded-xl bg-primary text-primary-foreground px-4 text-base font-semibold inline-flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArchiveRestore className="w-5 h-5" />}
                  Restore
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                className="min-h-12 rounded-xl border border-border px-4 text-base font-medium inline-flex items-center justify-center gap-2 hover:bg-secondary/60 transition-colors"
                title="Open the recipe"
              >
                <Pencil className="w-4 h-4" /> Open
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
