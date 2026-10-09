/**
 * Recipe lifecycle — the UI half: Draft → On the menu → Archived (Graeme,
 * 2026-10-02; migrations 0141 archive, 0142 drafts).
 *
 *   ArchiveRecipeDialog   "Archive 'X'?" confirm with the plan / core-menu
 *                         heads-ups from archive-check; Undo toast after.
 *   MoveToDraftDialog     "Move 'X' to drafts?" — the same confirm and
 *                         heads-ups; a core-menu / special recipe must be
 *                         taken off the menu first (asked, never silent).
 *   ArchivedRecipesPanel  the Archived view on the Recipes page: big greyed
 *                         cards, "Archived 2 Oct by Graeme", big Restore.
 *   DraftRecipesPanel     the Drafts view: big cards with a Draft badge and
 *                         a big "Put on the menu".
 *   RecipeArchiveFooter   foot of Edit Recipe: the stage and the moves.
 *   RecipeDraftBadge      the small "Draft" pill used wherever a draft is
 *                         listed beside menu recipes (Product Hub, test boxes).
 *   useRecipeArchiveActions  archive / restore / draft / publish mutations
 *                         (React Query) that refresh every recipe list and
 *                         picker afterwards; each move toasts with Undo.
 *
 * Pure rules (stages, filtering, labels, warning wording) live in
 * lib/recipe-archive.ts and are unit-tested there.
 */
import { useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getListRecipesQueryKey } from "@workspace/api-client-react";
import { Archive, ArchiveRestore, AlertTriangle, BarChart2, FlaskConical, Loader2, Pencil, Rocket } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { archivedLabel, archiveWarnings, draftedLabel, draftMenuQuestion, menuFlagQuestion } from "@/lib/recipe-archive";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ArchiveCheckResponse = {
  recipe: { id: number; name: string; archivedAt: string | null; isDraft?: boolean; isCoreMenu: boolean; isCurrentSpecial: boolean };
  upcomingPlans: Array<{ planId: number; planDate: string; name: string; status: string }>;
  today: string;
};

type LifecycleResponse = { recipe: { id: number; name: string; isDraft?: boolean; archivedAt?: string | null } };

async function postJson<T>(path: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

/** Archive / restore / draft / publish, refreshing the recipe list and every
 *  picker that reads its own recipe-options endpoint. */
export function useRecipeArchiveActions() {
  const queryClient = useQueryClient();
  const refresh = (id: number) => {
    queryClient.invalidateQueries({ queryKey: getListRecipesQueryKey() });
    queryClient.invalidateQueries({ queryKey: [`/api/recipes/${id}`] });
    queryClient.invalidateQueries({ queryKey: ["recipe-archive-check", id] });
    queryClient.invalidateQueries({ queryKey: ["defects", "recipe-options"] });
    queryClient.invalidateQueries({ queryKey: ["defects", "items"] });
    queryClient.invalidateQueries({ queryKey: ["test-boxes", "recipe-options"] });
    queryClient.invalidateQueries({ queryKey: ["survey-recipe-options"] });
    queryClient.invalidateQueries({ queryKey: ["case-recipe-limits"] });
    queryClient.invalidateQueries({ queryKey: ["timing-health"] });
  };
  const archive = useMutation({
    mutationFn: ({ id, clearMenuFlags }: { id: number; clearMenuFlags?: boolean }) =>
      postJson<LifecycleResponse>(`/api/recipes/${id}/archive`, clearMenuFlags ? { clearMenuFlags: true } : {}),
    onSuccess: (_d, v) => refresh(v.id),
  });
  const restore = useMutation({
    mutationFn: (id: number) => postJson<LifecycleResponse>(`/api/recipes/${id}/restore`),
    onSuccess: (_d, id) => refresh(id),
  });
  const draft = useMutation({
    mutationFn: ({ id, clearMenuFlags }: { id: number; clearMenuFlags?: boolean }) =>
      postJson<LifecycleResponse>(`/api/recipes/${id}/draft`, clearMenuFlags ? { clearMenuFlags: true } : {}),
    onSuccess: (_d, v) => refresh(v.id),
  });
  const publish = useMutation({
    mutationFn: (id: number) => postJson<LifecycleResponse>(`/api/recipes/${id}/publish`),
    onSuccess: (_d, id) => refresh(id),
  });

  async function restoreWithToast(recipe: { id: number; name: string }) {
    try {
      const res = await restore.mutateAsync(recipe.id);
      // Restoring returns a recipe to whatever is_draft says (migration 0142).
      toast(res.recipe?.isDraft
        ? { title: `Restored "${recipe.name}" to Drafts`, description: "It was a draft when it was archived, so it's back in Drafts — put it on the menu when it's ready." }
        : { title: `Restored "${recipe.name}"`, description: "It's back in the Recipes list and every picker." });
    } catch (err) {
      toast({ title: "Couldn't restore it", description: err instanceof Error ? err.message : "Try again in a moment.", variant: "destructive" });
    }
  }

  async function archiveWithToast(recipe: { id: number; name: string }, clearMenuFlags = false): Promise<boolean> {
    try {
      await archive.mutateAsync({ id: recipe.id, clearMenuFlags });
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

  async function publishWithToast(recipe: { id: number; name: string }, opts: { undoable?: boolean } = {}): Promise<boolean> {
    try {
      await publish.mutateAsync(recipe.id);
      toast({
        title: `"${recipe.name}" is on the menu`,
        description: "It's now offered for plans, stock and sales.",
        action: opts.undoable === false
          ? undefined
          : <ToastAction altText="Undo" onClick={() => void moveToDraftWithToast(recipe, false, { undoable: false })}>Undo</ToastAction>,
      });
      return true;
    } catch (err) {
      toast({ title: "Couldn't put it on the menu", description: err instanceof Error ? err.message : "Try again in a moment.", variant: "destructive" });
      return false;
    }
  }

  async function moveToDraftWithToast(recipe: { id: number; name: string }, clearMenuFlags = false, opts: { undoable?: boolean } = {}): Promise<boolean> {
    try {
      await draft.mutateAsync({ id: recipe.id, clearMenuFlags });
      toast({
        title: `"${recipe.name}" moved to Drafts`,
        description: clearMenuFlags
          ? "Taken off the menu. Undo puts it back on the menu but won't re-tick Core menu or Special."
          : "It won't be offered for plans, stock or sales until it's put back on the menu.",
        action: opts.undoable === false
          ? undefined
          : <ToastAction altText="Undo" onClick={() => void publishWithToast(recipe, { undoable: false })}>Undo</ToastAction>,
      });
      return true;
    } catch (err) {
      toast({ title: "Couldn't move it to drafts", description: err instanceof Error ? err.message : "Try again in a moment.", variant: "destructive" });
      return false;
    }
  }

  return { archive, restore, draft, publish, archiveWithToast, restoreWithToast, moveToDraftWithToast, publishWithToast };
}

/** The small "Draft" pill shown wherever a draft is listed beside menu
 *  recipes (Product Hub, test boxes, Edit Recipe). */
export function RecipeDraftBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:text-amber-100 ${className}`}>
      <FlaskConical className="w-3 h-3" /> Draft
    </span>
  );
}

export function ArchiveRecipeDialog({ recipe, onClose, onArchived }: {
  recipe: { id: number; name: string } | null;
  onClose: () => void;
  onArchived?: () => void;
}) {
  return <RecipeMoveDialog mode="archive" recipe={recipe} onClose={onClose} onDone={onArchived} />;
}

/** "Move 'X' to drafts?" — the same checks as archiving (Graeme, 2026-10-02). */
export function MoveToDraftDialog({ recipe, onClose, onMoved }: {
  recipe: { id: number; name: string } | null;
  onClose: () => void;
  onMoved?: () => void;
}) {
  return <RecipeMoveDialog mode="draft" recipe={recipe} onClose={onClose} onDone={onMoved} />;
}

function RecipeMoveDialog({ mode, recipe, onClose, onDone }: {
  mode: "archive" | "draft";
  recipe: { id: number; name: string } | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const open = recipe != null;
  // Keep the last recipe's name on screen while the dialog animates closed.
  const lastRef = useRef(recipe);
  if (recipe) lastRef.current = recipe;
  const shown = recipe ?? lastRef.current;
  const { archive, draft, archiveWithToast, moveToDraftWithToast } = useRecipeArchiveActions();
  const pending = mode === "archive" ? archive.isPending : draft.isPending;
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
  const question = check.data
    ? (mode === "archive" ? menuFlagQuestion(check.data.recipe) : draftMenuQuestion(check.data.recipe))
    : null;
  const warnings = check.data
    ? archiveWarnings({ upcomingPlans: check.data.upcomingPlans, isCoreMenu: check.data.recipe.isCoreMenu, isCurrentSpecial: check.data.recipe.isCurrentSpecial }, check.data.today)
    : [];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[92dvh] overflow-y-auto bg-card border-border rounded-2xl p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl pr-6">
            {mode === "archive" ? `Archive "${shown?.name}"?` : `Move "${shown?.name}" to drafts?`}
          </DialogTitle>
          <DialogDescription className="text-base text-foreground/80 pt-1">
            {mode === "archive"
              ? "It disappears from lists and pickers but nothing is deleted — restore any time from Archived."
              : "Nothing in the recipe changes — it just won't be offered for plans, stock or sales until it's put back on the menu. You can still cost it, check its deck and label, and trial it in a test box."}
          </DialogDescription>
        </DialogHeader>

        {check.isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Checking plans…</p>
        )}
        {check.isError && (
          <p className="text-sm text-muted-foreground">Couldn't check upcoming plans just now — {mode === "archive" ? "archiving" : "moving it"} is still safe; anything already planned is still made.</p>
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

        {question && (
          <div className="flex gap-3 rounded-xl border-2 border-red-400/60 bg-red-50 dark:bg-red-950/30 p-3 text-base text-red-950 dark:text-red-100">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
            <span>{question.message}</span>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-12 rounded-xl border border-border px-4 text-base font-medium hover:bg-secondary/60 transition-colors"
          >
            {mode === "archive" ? (question ? "Don't archive" : "Keep it") : "Keep it on the menu"}
          </button>
          <button
            type="button"
            disabled={pending || !recipe || check.isLoading}
            onClick={async () => {
              if (!recipe) return;
              const ok = mode === "archive"
                ? await archiveWithToast(recipe, !!question)
                : await moveToDraftWithToast(recipe, !!question);
              if (ok) { onClose(); onDone?.(); }
            }}
            className="flex-1 min-h-12 rounded-xl bg-foreground text-background px-4 text-base font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {pending ? <Loader2 className="w-5 h-5 animate-spin" /> : mode === "archive" ? <Archive className="w-5 h-5" /> : <FlaskConical className="w-5 h-5" />}
            {question ? question.confirmLabel : mode === "archive" ? "Archive recipe" : "Move to drafts"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Foot of Edit Recipe (managers/admins): the recipe's stage and the moves
 *  out of it. On the menu → "Move to drafts" + "Archive". Draft → a big
 *  "Put on the menu" + "Archive". Archived → who archived it + big Restore
 *  (back to Drafts if it was a draft). */
export function RecipeArchiveFooter({ recipe, onArchive, onMoveToDraft }: {
  recipe: { id: number; name: string; archivedAt: string | null; archivedByName: string | null; isDraft?: boolean };
  onArchive: () => void;
  onMoveToDraft?: () => void;
}) {
  const { restore, publish, restoreWithToast, publishWithToast } = useRecipeArchiveActions();
  if (recipe.archivedAt) {
    return (
      <div className="mt-6 rounded-2xl border-2 border-dashed border-border bg-muted/40 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <p className="text-base font-semibold">{archivedLabel(recipe.archivedAt, recipe.archivedByName)}</p>
          <p className="text-sm text-muted-foreground">
            Hidden from the Recipes list and every picker. Nothing was deleted.
            {recipe.isDraft ? " It was a draft, so restoring puts it back in Drafts." : ""}
          </p>
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
  if (recipe.isDraft) {
    return (
      <div className="mt-6 rounded-2xl border-2 border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-testid="draft-footer">
        <div className="flex-1">
          <p className="text-base font-semibold flex items-center gap-2"><FlaskConical className="w-5 h-5 text-amber-600" /> This recipe is a draft</p>
          <p className="text-sm text-muted-foreground">Not offered for plans, stock or sales yet. Cost it, check its deck and label, trial it in a test box — then put it on the menu.</p>
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            onClick={onArchive}
            className="min-h-12 rounded-xl border border-border bg-card px-4 text-base font-medium inline-flex items-center justify-center gap-2 hover:bg-secondary/60 transition-colors"
          >
            <Archive className="w-5 h-5" /> Archive
          </button>
          <button
            type="button"
            disabled={publish.isPending}
            onClick={() => void publishWithToast(recipe)}
            className="min-h-12 rounded-xl bg-primary text-primary-foreground px-5 text-base font-semibold inline-flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {publish.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Rocket className="w-5 h-5" />}
            Put on the menu
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-2xl border border-border p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1">
        <p className="text-base font-semibold">Not making this right now?</p>
        <p className="text-sm text-muted-foreground">Move it to drafts if it's back in development, or archive it if we've stopped making it. Nothing is deleted either way.</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        {onMoveToDraft && (
          <button
            type="button"
            onClick={onMoveToDraft}
            className="min-h-12 rounded-xl border border-border px-5 text-base font-medium inline-flex items-center justify-center gap-2 hover:bg-secondary/60 transition-colors"
          >
            <FlaskConical className="w-5 h-5" /> Move to drafts
          </button>
        )}
        <button
          type="button"
          onClick={onArchive}
          className="min-h-12 rounded-xl border border-border px-5 text-base font-medium inline-flex items-center justify-center gap-2 hover:bg-secondary/60 transition-colors"
        >
          <Archive className="w-5 h-5" /> Archive recipe
        </button>
      </div>
    </div>
  );
}

export type DraftRecipeRow = {
  id: number; name: string; category?: string | null; color?: string | null;
  rrp?: number | string | null; grossMargin?: number | null;
  draftedAt?: string | null; draftedByName?: string | null;
};

/** The Drafts view on the Recipes page: big cards, Draft badge, a big
 *  "Put on the menu" for managers and admins. */
export function DraftRecipesPanel({ recipes, canManage, onOpen, onArchive, onBreakdown }: {
  recipes: DraftRecipeRow[];
  canManage: boolean;
  onOpen: (id: number) => void;
  onArchive?: (recipe: { id: number; name: string }) => void;
  onBreakdown?: (id: number) => void;
}) {
  const { publish, publishWithToast } = useRecipeArchiveActions();

  if (recipes.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground rounded-2xl border-2 border-dashed border-border">
        <FlaskConical className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-lg font-medium">No drafts</p>
        <p className="text-sm mt-1 px-4">New recipe ideas start here. They're kept out of plans, stock and sales until you put them on the menu.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {recipes.map(r => {
        const busy = publish.isPending && publish.variables === r.id;
        const rrp = Number(r.rrp) || 0;
        const margin = r.grossMargin;
        return (
          <div key={r.id} className="rounded-2xl border-2 border-amber-300/70 dark:border-amber-700/60 bg-card p-5 flex flex-col gap-3" data-testid="draft-recipe-card">
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-tight flex items-center gap-2">
                {r.color && <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: r.color }} />}
                <span className="truncate">{r.name}</span>
              </p>
              {r.category && <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">{r.category}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-3 py-1 text-sm font-medium text-amber-900 dark:text-amber-100">
                <FlaskConical className="w-3.5 h-3.5" /> {draftedLabel(r.draftedAt, r.draftedByName)}
              </span>
              {rrp > 0 && (
                <span className="text-sm text-muted-foreground tabular-nums">
                  £{rrp.toFixed(2)}{margin != null && Number.isFinite(Number(margin)) ? ` · ${Number(margin).toFixed(1)}% GP` : ""}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-auto pt-1">
              {canManage && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void publishWithToast(r)}
                  className="w-full min-h-12 rounded-xl bg-primary text-primary-foreground px-4 text-base font-semibold inline-flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Rocket className="w-5 h-5" />}
                  Put on the menu
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                className="flex-1 min-h-12 rounded-xl border border-border px-4 text-base font-medium inline-flex items-center justify-center gap-2 hover:bg-secondary/60 transition-colors"
              >
                <Pencil className="w-4 h-4" /> Open
              </button>
              {onBreakdown && (
                <button
                  type="button"
                  onClick={() => onBreakdown(r.id)}
                  className="min-h-12 min-w-12 rounded-xl border border-border px-4 text-base font-medium inline-flex items-center justify-center gap-2 hover:bg-secondary/60 transition-colors"
                  title="Cost breakdown"
                  aria-label={`Cost breakdown for ${r.name}`}
                >
                  <BarChart2 className="w-4 h-4" />
                </button>
              )}
              {canManage && onArchive && (
                <button
                  type="button"
                  onClick={() => onArchive({ id: r.id, name: r.name })}
                  className="min-h-12 min-w-12 rounded-xl border border-border px-4 text-base font-medium inline-flex items-center justify-center gap-2 hover:bg-secondary/60 transition-colors"
                  title="Archive (hide, keep everything)"
                  aria-label={`Archive ${r.name}`}
                >
                  <Archive className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type ArchivedRecipeRow = {
  id: number; name: string; category?: string | null; color?: string | null;
  archivedAt?: string | null; archivedByName?: string | null; isDraft?: boolean;
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
              {r.isDraft && <span className="font-medium"> · was a draft</span>}
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
                  {r.isDraft ? "Restore to Drafts" : "Restore"}
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
