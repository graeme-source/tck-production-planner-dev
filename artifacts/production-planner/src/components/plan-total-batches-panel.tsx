/**
 * Create Plan's left-hand "Total batches" card (Graeme, 28 Oct 2026: "We
 * basically want one input field here and a suggestion, as well as how many
 * people we've got on shift with regards to the dough prep person. That's the
 * only thing we want to know.").
 *
 * One big number with − / + — the total the recipe rows are shared to
 * (lib/plan-batch-total.ts) — one suggestion line with "Use N" when it
 * differs, one team line, and a small "Rows add up to N" only when a row has
 * been edited by hand so the two never silently disagree. The capacity maths
 * behind the suggestion (rota cap, fewest a day, factory levels) is still
 * used; it just isn't shown.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Minus, Plus, SlidersHorizontal, Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { rotaLine } from "@/lib/plan-batch-total";

export interface ScheduleCapacityData {
  available: boolean;
  reason?: string;
  date?: string;
  people?: Array<{ name: string; position: string; start: string | null; end: string | null }>;
  excluded?: Array<{ name: string; position: string; start: string | null; end: string | null }>;
  teamSize?: number;
  hasDoughPrep?: boolean;
  capacityBatches?: number;
  capacityWithDoughPrep?: number;
  capacityWithoutDoughPrep?: number;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** The plan date's Planday rota (GET /production-plans/schedule-capacity). */
export function useScheduleCapacity(planDate: string, enabled: boolean) {
  const q = useQuery({
    queryKey: ["schedule-capacity", planDate],
    queryFn: async (): Promise<ScheduleCapacityData> => {
      try {
        const r = await fetch(`${BASE}/api/production-plans/schedule-capacity?planDate=${planDate}`, { credentials: "include" });
        return r.ok ? await r.json() : { available: false, reason: `HTTP ${r.status}` };
      } catch {
        return { available: false, reason: "Request failed" };
      }
    },
    enabled: enabled && !!planDate,
    staleTime: 5 * 60_000,
  });
  return { data: q.data, isLoading: enabled && !!planDate && q.isPending };
}

function dayLabel(planDate: string): string {
  const today = format(new Date(), "yyyy-MM-dd");
  if (planDate === today) return "today";
  try { return `on ${format(parseISO(planDate), "EEE d MMM")}`; } catch { return ""; }
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function PlanTotalBatchesPanel({ planDate, total, onTotalChange, suggested, rowsTotal, rota, rotaLoading, onEditDpt }: {
  planDate: string;
  /** The total the rows are shared to. */
  total: number;
  onTotalChange: (n: number) => void;
  /** Rota + factory-levels suggestion for this date (null while working it out). */
  suggested: number | null;
  /** What the ticked rows add up to (day capacity, same units as `total`). */
  rowsTotal: number;
  rota: ScheduleCapacityData | null;
  rotaLoading: boolean;
  onEditDpt: () => void;
}) {
  // Typing is held as text so an emptied box doesn't snap to 0 mid-edit.
  const [draft, setDraft] = useState(String(total));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(String(total)); }, [total, editing]);

  const commit = (n: number) => onTotalChange(Math.max(0, Math.round(n)));
  const step = (d: number) => { setEditing(false); commit(total + d); };
  const team = rota?.available ? rotaLine(rota, dayLabel(planDate)) : null;
  const mismatch = Math.abs(rowsTotal - total) >= 0.05;

  return (
    <section aria-label="Total batches" className="rounded-2xl border-2 border-border bg-secondary/20 p-4 space-y-3">
      <label htmlFor="plan-total-batches" className="block text-base font-semibold text-foreground">Total batches</label>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={total <= 0}
          aria-label="One batch fewer"
          className="h-14 w-14 flex-shrink-0 rounded-xl border-2 border-border bg-background flex items-center justify-center hover:bg-secondary/60 active:scale-95 transition disabled:opacity-40"
        >
          <Minus className="w-6 h-6" />
        </button>
        <input
          id="plan-total-batches"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={draft}
          onFocus={e => { setEditing(true); e.currentTarget.select(); }}
          onBlur={() => { setEditing(false); if (draft.trim() === "") setDraft(String(total)); }}
          onChange={e => {
            setDraft(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== "" && Number.isFinite(n)) commit(n);
          }}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onWheel={e => { if (document.activeElement === e.currentTarget) e.currentTarget.blur(); }}
          className="h-14 min-w-0 flex-1 rounded-xl border-2 border-border bg-background text-center text-3xl font-bold tabular-nums text-foreground focus-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="One batch more"
          className="h-14 w-14 flex-shrink-0 rounded-xl border-2 border-border bg-background flex items-center justify-center hover:bg-secondary/60 active:scale-95 transition"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

      {suggested != null && (
        <div className="flex items-center justify-between gap-2 min-h-10">
          <span className="text-base text-foreground">Suggested: <span className="font-bold tabular-nums">{suggested}</span> batches</span>
          {suggested !== total && (
            <button
              type="button"
              onClick={() => { setEditing(false); commit(suggested); }}
              className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors flex-shrink-0"
            >
              Use {suggested}
            </button>
          )}
        </div>
      )}

      {mismatch && (
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Rows add up to {fmt(rowsTotal)}</p>
      )}

      {rotaLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Checking the rota…</p>
      ) : team ? (
        <p className="flex items-start gap-2 text-sm">
          <Users className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
          <span>
            <span className="text-foreground">{team.onShift}</span>
            {" · "}
            <span className={cn("font-semibold", team.doughPrep ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
              {team.doughPrep ?? "No dough prep on shift"}
            </span>
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2 text-sm text-muted-foreground" title={rota?.reason}>
          <Users className="w-4 h-4 mt-0.5 flex-shrink-0" /> No rota for this day
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onEditDpt}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          title="Edit DPT settings — usual daily batches and per-recipe packs sold"
        >
          <SlidersHorizontal className="w-3 h-3" /> Edit DPT
        </button>
      </div>
    </section>
  );
}
