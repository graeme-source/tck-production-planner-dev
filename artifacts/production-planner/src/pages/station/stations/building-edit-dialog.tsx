/**
 * "Edit production numbers — <recipe>" on the building station (Graeme,
 * 2026-10-09): "We just had an extra batch, and both builders ... could not
 * figure out how to amend it. ... What we want is a button that just says
 * 'Edit'."
 *
 * Two counters — Batches and Extra packs — each with − / +. Taps only STAGE
 * a change; nothing is written until Save, which shows exactly what will
 * change ("Batches 6 → 5, Extra packs 0 → 2"). Cancel, the X, Escape or a
 * tap outside throw the staged changes away.
 *
 * The rules (which batch comes off, where packs go, the floors and their
 * wording) are @workspace/building-edit, the same code the server re-checks
 * with inside its transaction (routes/building-edit.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus, X, Pencil, AlertTriangle } from "lucide-react";
import {
  BATCH_WORDS,
  PACK_WORDS,
  editBlockReason,
  editSummary,
  planBuildEdit,
  type BuildEditState,
  type BuildNumbers,
  type EditTarget,
} from "@workspace/building-edit";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface BuildingEditData {
  itemId: number;
  recipeName: string | null;
  countsPacks: boolean;
  packsPerBatch: number;
  ovenBatches: number;
  packsStored: number;
  stationExtras: Record<string, number>;
  completions: Array<{ id: number; stationType: string; completedAt: string; partialPacks: number | null }>;
  numbers: BuildNumbers;
}

export const buildingEditQueryKey = (planId: number, itemId: number) =>
  ["building-edit", planId, itemId] as const;

class SaveError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function BuildingEditDialog({
  planId, itemId, recipeName, recipeColor, stationType, lineNumber, onClose, onSaved, onEditLeftover,
}: {
  planId: number;
  /** null = closed. */
  itemId: number | null;
  recipeName: string;
  recipeColor?: string | null;
  stationType: "building_1" | "building_2";
  lineNumber: number;
  onClose: () => void;
  /** Called after a successful save with the change in batch count. */
  onSaved?: (batchDelta: number) => void;
  /** Shown as a link when the recipe has a filling to weigh back. */
  onEditLeftover?: () => void;
}) {
  const open = itemId != null;
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<BuildingEditData>({
    queryKey: buildingEditQueryKey(planId, itemId ?? 0),
    queryFn: async () => {
      const res = await fetch(`/api/production-plans/${planId}/items/${itemId}/building-edit`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load the numbers (${res.status})`);
      return res.json();
    },
    enabled: open,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  // The staged numbers. Reset whenever fresh numbers arrive from the server
  // (on open, and after a 409 reload).
  const [staged, setStaged] = useState<EditTarget | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (data) setStaged({ batches: data.numbers.batches, extraPacks: data.numbers.extraPacks });
  }, [data]);
  useEffect(() => {
    if (!open) { setStaged(null); setProblem(null); }
  }, [open]);

  const state: BuildEditState | null = useMemo(() => data ? {
    completions: data.completions,
    stationExtras: data.stationExtras,
    packsPerBatch: data.packsPerBatch,
    ovenBatches: data.ovenBatches,
    packsStored: data.packsStored,
  } : null, [data]);

  const unit = data?.countsPacks ? PACK_WORDS : BATCH_WORDS;
  const before = data ? { batches: data.numbers.batches, extraPacks: data.numbers.extraPacks } : null;
  const plan = state && staged ? planBuildEdit(state, staged, stationType) : null;
  const summary = before && staged ? editSummary(before, staged, unit) : "";
  const blockNow = state && staged ? editBlockReason(state, staged, stationType, unit) : null;
  const whyNotLower = (field: keyof EditTarget): string | null =>
    state && staged ? editBlockReason(state, { ...staged, [field]: staged[field] - 1 }, stationType, unit) : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!staged || !before) throw new SaveError(400, "Nothing to save");
      const res = await fetch(`/api/production-plans/${planId}/items/${itemId}/building-edit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationType, batches: staged.batches, extraPacks: staged.extraPacks, expected: before }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new SaveError(res.status, (body as { error?: string }).error ?? `Save failed (${res.status})`);
      return body as BuildingEditData & { summary: string };
    },
    onSuccess: (result) => {
      const delta = result.numbers.batches - (before?.batches ?? result.numbers.batches);
      // Everything that shows these numbers: the plan (counters, ovens,
      // wrapping), the run rate / KPI, pace, target finish, the dashboard.
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = String(q.queryKey[0] ?? "");
          return k.startsWith(`/api/production-plans/${planId}`) || k.includes("building-target-finish") || k === "building-edit";
        },
      });
      toast({ title: `${recipeName}: saved`, description: result.summary || "No change" });
      onSaved?.(delta);
      onClose();
    },
    onError: (err) => {
      if (err instanceof SaveError && err.status === 423) {
        setProblem("Enter your PIN on the pad, then tap Save again.");
      } else if (err instanceof SaveError && err.status === 409) {
        setProblem(err.message);
        refetch();
      } else {
        setProblem(err instanceof Error ? err.message : "Couldn't save — try again.");
      }
    },
  });

  const step = (field: keyof EditTarget, d: 1 | -1) => {
    setProblem(null);
    setStaged(s => s ? { ...s, [field]: s[field] + d } : s);
  };

  const lineName = `Line ${lineNumber}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !save.isPending) onClose(); }}>
      <DialogContent
        className="w-[calc(100vw-1.5rem)] sm:max-w-2xl max-h-[92dvh] p-0 gap-0 flex flex-col overflow-hidden rounded-2xl [&>button:last-child]:hidden"
      >
        {/* Header — big X, always visible */}
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-border flex-shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Edit production numbers</p>
            <DialogTitle className="text-2xl font-bold leading-tight truncate" style={{ color: recipeColor || undefined }}>
              {recipeName}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-0.5">
              What's recorded today on both lines. Change it with − and +, then Save.
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={save.isPending}
            aria-label="Close without saving"
            className="h-12 w-12 -mr-1 flex items-center justify-center rounded-xl border border-border hover:bg-secondary/60 flex-shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body — scrolls inside the card */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {isLoading || (!data && !isError) || !staged ? (
            isError ? (
              <div className="py-10 text-center space-y-3">
                <p className="font-semibold">Couldn't load the numbers.</p>
                <button type="button" onClick={() => refetch()} className="px-4 py-2 rounded-lg border border-border font-semibold">Try again</button>
              </div>
            ) : (
              <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            )
          ) : (
            <>
              <div className={cn("grid gap-3", !data!.countsPacks && "sm:grid-cols-2")}>
                <Counter
                  label={data!.countsPacks ? "Packs" : "Batches"}
                  value={staged.batches}
                  was={before!.batches}
                  onMinus={() => step("batches", -1)}
                  onPlus={() => step("batches", 1)}
                  minusBlockedBy={whyNotLower("batches")}
                  disabled={save.isPending}
                  note={data!.numbers.partBatches > 0
                    ? `Includes ${data!.numbers.partBatches} part batch${data!.numbers.partBatches === 1 ? "" : "es"} (${data!.numbers.partBatchPacks} pack${data!.numbers.partBatchPacks === 1 ? "" : "s"})`
                    : null}
                />
                {!data!.countsPacks && (
                  <Counter
                    label="Extra packs"
                    value={staged.extraPacks}
                    was={before!.extraPacks}
                    onMinus={() => step("extraPacks", -1)}
                    onPlus={() => step("extraPacks", 1)}
                    minusBlockedBy={whyNotLower("extraPacks")}
                    disabled={save.isPending}
                    note="Loose packs not in a batch"
                  />
                )}
              </div>

              {!data!.countsPacks && plan && (
                <div className="flex items-center justify-between rounded-xl bg-secondary/40 px-4 py-3">
                  <span className="text-base font-semibold text-muted-foreground">Total packs</span>
                  <span className="text-2xl font-extrabold tabular-nums">
                    {plan.after.totalPacks !== plan.before.totalPacks && (
                      <span className="text-muted-foreground font-bold">{plan.before.totalPacks} → </span>
                    )}
                    {plan.after.totalPacks}
                  </span>
                </div>
              )}

              <p className="text-sm text-muted-foreground leading-snug">
                Taking a {unit.singular} off removes the most recent one recorded on {lineName}
                {" "}(or the other line if {lineName} has none), so the run rate updates.
                {" "}An added {unit.singular} is recorded now, as an edit by you.
                {data!.ovenBatches > 0 && ` ${data!.ovenBatches} ${data!.ovenBatches === 1 ? unit.singular : unit.plural} already through the ovens.`}
              </p>

              {onEditLeftover && (
                <button
                  type="button"
                  onClick={onEditLeftover}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline underline-offset-2"
                >
                  <Pencil className="w-4 h-4" /> Leftover filling for this recipe
                </button>
              )}
            </>
          )}
        </div>

        {/* Footer — summary + Save, always on screen */}
        <div className="border-t border-border px-5 py-3 space-y-2 flex-shrink-0 bg-background">
          {(problem || (summary && blockNow)) && (
            <p className="flex items-start gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {problem ?? blockNow}
            </p>
          )}
          <p className={cn("text-lg font-bold tabular-nums", !summary && "text-muted-foreground font-semibold text-base")}>
            {summary || "No changes yet"}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={save.isPending}
              className="flex-1 h-14 rounded-xl border-2 border-border font-bold text-lg hover:bg-secondary/60 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { setProblem(null); save.mutate(); }}
              disabled={!summary || !!blockNow || save.isPending}
              className="flex-[2] h-14 rounded-xl bg-primary text-primary-foreground font-bold text-lg hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {save.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Counter({
  label, value, was, onMinus, onPlus, minusBlockedBy, disabled, note,
}: {
  label: string;
  value: number;
  was: number;
  onMinus: () => void;
  onPlus: () => void;
  /** Why − is off (a downstream floor), or null when it can be tapped. */
  minusBlockedBy: string | null;
  disabled: boolean;
  note?: string | null;
}) {
  const changed = value !== was;
  return (
    <div className={cn(
      "rounded-2xl border-2 px-4 py-3 space-y-2",
      changed ? "border-primary bg-primary/5" : "border-border",
    )}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-lg font-bold">{label}</span>
        {changed && <span className="text-sm font-semibold text-muted-foreground">was {was}</span>}
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onMinus}
          disabled={disabled || !!minusBlockedBy}
          aria-label={`One fewer — ${label}`}
          className="h-16 w-16 rounded-2xl border-2 border-border bg-background flex items-center justify-center active:scale-95 transition-transform disabled:opacity-30 hover:bg-secondary/60"
        >
          <Minus className="w-8 h-8" strokeWidth={3} />
        </button>
        <span className="text-6xl font-extrabold tabular-nums leading-none">{value}</span>
        <button
          type="button"
          onClick={onPlus}
          disabled={disabled}
          aria-label={`One more — ${label}`}
          className="h-16 w-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center active:scale-95 transition-transform disabled:opacity-30 hover:bg-primary/90"
        >
          <Plus className="w-8 h-8" strokeWidth={3} />
        </button>
      </div>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      {minusBlockedBy && value > 0 && (
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300 leading-snug">{minusBlockedBy}</p>
      )}
    </div>
  );
}
