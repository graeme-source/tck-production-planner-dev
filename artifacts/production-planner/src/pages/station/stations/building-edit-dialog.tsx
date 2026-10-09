/**
 * "Edit production numbers — <recipe>" on the building station (Graeme,
 * 2026-10-09): "We just had an extra batch, and both builders ... could not
 * figure out how to amend it. ... What we want is a button that just says
 * 'Edit'."
 *
 * Two counters — Batches and Extra packs — each with − / +. Once a counter
 * changes, it asks which line the change comes off / goes on ("Line 1" /
 * "Line 2", each with that line's own count; Graeme: "You can ask which
 * line"), defaulting to the line doing the edit. Taps only STAGE
 * a change; nothing is written until Save, which shows exactly what will
 * change ("Batches 6 → 5, Extra packs 0 → 2"). Cancel, the X, Escape or a
 * tap outside throw the staged changes away.
 *
 * The rules (which batch comes off, where packs go, the floors and their
 * wording) are @workspace/building-edit, the same code the server re-checks
 * with inside its transaction (routes/building-edit.ts).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus, X, Pencil, AlertTriangle } from "lucide-react";
import {
  BATCH_WORDS,
  BUILDING_LINES,
  PACK_WORDS,
  editBlockReason,
  lineCanGive,
  lineLabel,
  lineNumbers,
  type EditLines,
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
  planId, itemId, recipeName, recipeColor, stationType, buildingFinishedAt, onClose, onSaved, onEditLeftover,
}: {
  planId: number;
  /** null = closed. */
  itemId: number | null;
  recipeName: string;
  recipeColor?: string | null;
  stationType: "building_1" | "building_2";
  /** Set once "Mark building finished" was pressed — the run-rate window
   *  ends there, so a correction changes the count only. */
  buildingFinishedAt?: string | null;
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
  // Which line each counter's change comes off / goes on. Default: the line
  // doing the edit.
  const [lines, setLines] = useState<EditLines>({ batches: stationType, extraPacks: stationType });
  useEffect(() => {
    if (data) setStaged({ batches: data.numbers.batches, extraPacks: data.numbers.extraPacks });
  }, [data]);
  useEffect(() => {
    if (!open) { setStaged(null); setProblem(null); setLines({ batches: stationType, extraPacks: stationType }); }
  }, [open, stationType]);

  const state: BuildEditState | null = useMemo(() => data ? {
    completions: data.completions,
    stationExtras: data.stationExtras,
    packsPerBatch: data.packsPerBatch,
    ovenBatches: data.ovenBatches,
    packsStored: data.packsStored,
  } : null, [data]);

  const unit = data?.countsPacks ? PACK_WORDS : BATCH_WORDS;
  const before = data ? { batches: data.numbers.batches, extraPacks: data.numbers.extraPacks } : null;
  // How many are being taken off each counter (≤ 0 = adding or unchanged).
  const off = (field: keyof EditTarget) => before && staged ? before[field] - staged[field] : 0;

  // If the chosen line can't give what's being taken off but the other line
  // can, switch to it — a line with nothing to remove is never the choice.
  useEffect(() => {
    if (!state || !staged || !before) return;
    for (const field of ["batches", "extraPacks"] as const) {
      const n = before[field] - staged[field];
      if (n <= 0 || lineCanGive(state, lines[field], field, n)) continue;
      const other = BUILDING_LINES.find(l => lineCanGive(state, l, field, n));
      if (other && other !== lines[field]) setLines(prev => ({ ...prev, [field]: other }));
    }
  }, [state, staged, before?.batches, before?.extraPacks, lines]);

  const plan = state && staged ? planBuildEdit(state, staged, lines) : null;
  const summary = before && staged ? editSummary(before, staged, unit, lines) : "";
  const blockNow = state && staged ? editBlockReason(state, staged, lines, unit) : null;
  // − is off only when NO line could give one more (then say why, for the
  // chosen line); otherwise the line choice moves to a line that can.
  const whyNotLower = (field: keyof EditTarget): string | null => {
    if (!state || !staged) return null;
    const next = { ...staged, [field]: staged[field] - 1 };
    const anyLineOk = BUILDING_LINES.some(l => editBlockReason(state, next, { ...lines, [field]: l }, unit) === null);
    return anyLineOk ? null : editBlockReason(state, next, lines, unit);
  };
  const lineChoice = (field: keyof EditTarget): ReactNode => {
    if (!state || !staged || !before || staged[field] === before[field]) return null;
    const n = off(field);
    return (
      <LineChoice
        question={n > 0 ? "Take it off which line?" : "Add it to which line?"}
        chosen={lines[field]}
        options={BUILDING_LINES.map(l => {
          const own = lineNumbers(state, l);
          const have = field === "batches" ? own.batches : Math.max(0, own.extraPacks);
          return {
            line: l,
            label: lineLabel(l),
            detail: `${have} ${field === "batches" ? (have === 1 ? unit.singular : unit.plural) : (have === 1 ? "pack" : "packs")} now`,
            disabled: n > 0 && !lineCanGive(state, l, field, n),
            you: l === stationType,
          };
        })}
        onChoose={(l) => { setProblem(null); setLines(prev => ({ ...prev, [field]: l })); }}
        disabled={save.isPending}
      />
    );
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!staged || !before) throw new SaveError(400, "Nothing to save");
      const res = await fetch(`/api/production-plans/${planId}/items/${itemId}/building-edit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stationType,
          batches: staged.batches,
          extraPacks: staged.extraPacks,
          expected: before,
          batchesLine: lines.batches,
          extraPacksLine: lines.extraPacks,
        }),
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

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !save.isPending) onClose(); }}>
      <DialogContent
        className="w-[calc(100vw-1.5rem)] sm:max-w-2xl max-h-[92dvh] p-0 gap-0 flex flex-col overflow-hidden rounded-2xl [&>button:last-child]:hidden"
        // Tapping the PIN pad (it opens on top when today's PIN is due) is
        // not a "tap outside" — keep the staged numbers so Save works after.
        onInteractOutside={(e) => {
          const t = e.target as Element | null;
          if (t?.closest?.("[data-pin-lock-overlay]")) e.preventDefault();
        }}
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
                >
                  {lineChoice("batches")}
                </Counter>
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
                  >
                    {lineChoice("extraPacks")}
                  </Counter>
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

              {buildingFinishedAt && (
                <p className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                  Building is marked finished at {format(parseISO(buildingFinishedAt), "HH:mm")} — this correction changes the count only, not the time.
                </p>
              )}

              <p className="text-sm text-muted-foreground leading-snug">
                Taking a {unit.singular} off removes the most recent one recorded on the line you pick, so the run rate updates.
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

/** "Which line?" — two big buttons, each with that line's own count. */
function LineChoice({ question, chosen, options, onChoose, disabled }: {
  question: string;
  chosen: string;
  options: Array<{ line: string; label: string; detail: string; disabled: boolean; you: boolean }>;
  onChoose: (line: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="pt-1 space-y-1.5" role="radiogroup" aria-label={question}>
      <p className="text-sm font-bold">{question}</p>
      <div className="grid grid-cols-2 gap-2">
        {options.map(o => {
          const on = o.line === chosen;
          return (
            <button
              key={o.line}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChoose(o.line)}
              disabled={disabled || o.disabled}
              className={cn(
                "min-h-[56px] rounded-xl border-2 px-3 py-2 text-left transition-colors disabled:opacity-35",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary/60",
              )}
            >
              <span className="block text-base font-extrabold leading-tight">
                {o.label}{o.you && <span className="font-semibold opacity-80"> · you</span>}
              </span>
              <span className={cn("block text-xs font-semibold tabular-nums", on ? "opacity-90" : "text-muted-foreground")}>
                {o.disabled ? "nothing to take off" : o.detail}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Counter({
  label, value, was, onMinus, onPlus, minusBlockedBy, disabled, note, children,
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
  /** The line choice, shown once this counter has changed. */
  children?: ReactNode;
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
      {children}
    </div>
  );
}
