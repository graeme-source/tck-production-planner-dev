/**
 * Quality rejects on the stations — "Wonky" and "Dog bin", two steppers with
 * the same + / − pattern, side by side wherever a wonky can be recorded
 * (ovens recipe panel, ovens end-of-recipe prompt, wrapping reject rack).
 *
 *   Wonky   — red, sold as wonky (Wonky Rack → Product Freezer).
 *   Dog bin — slate with a bin icon, thrown away, never stock.
 *
 * The hook owns the writes (routes/quality-rejects.ts): double-tap guard,
 * retry, failure toast and a refetch of the plan so the count on screen is
 * always the saved one. While a tap is saving its count shows "…".
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetProductionPlanQueryKey } from "@workspace/api-client-react";
import { AlertCircle, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { QUALITY_REJECT_COPY, type QualityRejectKind } from "@/lib/quality-rejects";

type RejectItem = { id: number; recipeName?: string | null; wonlyCount?: number | null; dogBinCount?: number | null };

export function rejectCount(item: RejectItem, kind: QualityRejectKind): number {
  return kind === "wonky" ? (item.wonlyCount ?? 0) : (item.dogBinCount ?? 0);
}

export function useQualityRejects({ planId, stationType, beforeAdd }: {
  planId: number;
  stationType: "ovens" | "wrapping";
  /** Return a reason to refuse a + tap (shown as a toast), or null to allow. */
  beforeAdd?: (item: RejectItem, kind: QualityRejectKind) => string | null;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{ itemId: number; kind: QualityRejectKind } | null>(null);
  const [run, busy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) }),
  });

  const tap = async (item: RejectItem, kind: QualityRejectKind, delta: 1 | -1) => {
    const copy = QUALITY_REJECT_COPY[kind];
    if (delta < 0 && rejectCount(item, kind) <= 0) return;
    if (delta > 0 && beforeAdd) {
      const refusal = beforeAdd(item, kind);
      if (refusal) {
        toast({ title: "Nothing left to reject", description: refusal, variant: "destructive" });
        return;
      }
    }
    setPending({ itemId: item.id, kind });
    await run(async (signal) => {
      await guardedFetch(`/api/production-plans/${planId}/items/${item.id}/${copy.path}`, {
        method: delta > 0 ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationType }),
        signal,
      });
      if (delta > 0) {
        toast({
          title: copy.recorded,
          description: kind === "dog_bin"
            ? `${item.recipeName ?? "Recipe"}: thrown away — not counted as stock.`
            : `Quality reject logged for ${item.recipeName ?? "recipe"}.`,
        });
      }
    });
    setPending(null);
  };

  return {
    add: (item: RejectItem, kind: QualityRejectKind) => tap(item, kind, 1),
    remove: (item: RejectItem, kind: QualityRejectKind) => tap(item, kind, -1),
    isPending: (itemId: number, kind: QualityRejectKind) => pending?.itemId === itemId && pending.kind === kind,
    busy,
  };
}

const TONES: Record<QualityRejectKind, {
  icon: typeof Trash2;
  label: string;
  count: string;
  plus: string;
  minus: string;
  card: string;
}> = {
  wonky: {
    icon: AlertCircle,
    label: "text-red-700 dark:text-red-300",
    count: "text-red-600 dark:text-red-400",
    plus: "bg-red-500 text-white hover:bg-red-600",
    minus: "border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30",
    card: "border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20",
  },
  dog_bin: {
    icon: Trash2,
    label: "text-slate-700 dark:text-slate-200",
    count: "text-slate-700 dark:text-slate-200",
    plus: "bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500",
    minus: "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60",
    card: "border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-900/40",
  },
};

/** One kind's stepper: icon + label + fate on the left, − count + on the right. */
export function RejectStepper({ kind, count, pending, onAdd, onRemove, disabled = false, compact = false }: {
  kind: QualityRejectKind;
  count: number;
  pending: boolean;
  onAdd: () => void;
  onRemove: () => void;
  /** Both buttons off (break, busy). */
  disabled?: boolean;
  /** Tighter card for the per-recipe rack rows. */
  compact?: boolean;
}) {
  const tone = TONES[kind];
  const copy = QUALITY_REJECT_COPY[kind];
  const Icon = tone.icon;
  return (
    <div className={cn(
      "flex items-center justify-between gap-2 rounded-xl border",
      compact ? "px-2 py-1.5" : "px-3 py-2",
      tone.card,
    )}>
      <div className="min-w-0 flex items-center gap-1.5">
        <Icon className={cn("flex-shrink-0", compact ? "w-4 h-4" : "w-5 h-5", tone.label)} />
        <div className="min-w-0">
          <p className={cn("font-semibold leading-tight", compact ? "text-sm" : "text-base", tone.label)}>{copy.label}</p>
          {!compact && <p className="text-xs text-muted-foreground leading-tight">{copy.fate}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          disabled={disabled || pending || count <= 0}
          aria-label={`Take one ${copy.label.toLowerCase()} off`}
          className={cn(
            "flex items-center justify-center rounded-full border bg-background disabled:opacity-30 transition-colors",
            compact ? "w-11 h-11" : "w-12 h-12",
            tone.minus,
          )}
        >
          <Minus className="w-5 h-5" />
        </button>
        <span className={cn("font-bold tabular-nums text-center", compact ? "text-xl w-8" : "text-2xl w-9", count > 0 ? tone.count : "text-muted-foreground")}>
          {pending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : count}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          disabled={disabled || pending}
          aria-label={`Add one ${copy.label.toLowerCase()}`}
          className={cn(
            "flex items-center justify-center rounded-full disabled:opacity-40 transition-colors",
            compact ? "w-11 h-11" : "w-12 h-12",
            tone.plus,
          )}
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

/** Both steppers for one plan item, wonky first. */
export function QualityRejectSteppers({ item, rejects, disabled = false, wonkyLocked = false, compact = false, className }: {
  item: RejectItem;
  rejects: ReturnType<typeof useQualityRejects>;
  disabled?: boolean;
  /** Wonky buttons off while the rack's transfer-to-freezer banner is up;
   *  dog bins are never transferred, so they stay live. */
  wonkyLocked?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2", className)}>
      {(["wonky", "dog_bin"] as const).map(kind => (
        <RejectStepper
          key={kind}
          kind={kind}
          compact={compact}
          count={rejectCount(item, kind)}
          pending={rejects.isPending(item.id, kind)}
          onAdd={() => rejects.add(item, kind)}
          onRemove={() => rejects.remove(item, kind)}
          disabled={disabled || rejects.busy || (kind === "wonky" && wonkyLocked)}
        />
      ))}
    </div>
  );
}
