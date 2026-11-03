/**
 * "Automatically order every [day]" on an ingredient's kanban settings
 * (Fix queue #348, Graeme 3 Nov 2026): "it automatically gets put into the
 * order list for us to then choose to order it or not (but we don't have to
 * remember it)".
 *
 * Pick the weekday(s) and a fixed number of packs. On those days the item
 * comes up on its supplier's card on the Orders page ("Every Fri"),
 * whatever the stock. Autosaves with a visible save state on its own
 * endpoint (GET/PUT /api/standing-orders/ingredients/:id), so it never
 * waits for the dialog's Save. Objective C.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Loader2, Minus, Plus } from "lucide-react";
import {
  ISO_WEEKDAYS,
  WEEKDAY_SHORT,
  MAX_STANDING_ORDER_PACKS,
  standingDaysSupplierSkips,
  standingOrderLabel,
  type IsoWeekday,
} from "@workspace/business-days";
import { formatPackSize, packNoun } from "@workspace/units";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const url = (id: number) => `${BASE}/api/standing-orders/ingredients/${id}`;
const queryKey = (id: number) => ["ingredient-standing-order", id] as const;

type StandingOrderData = {
  ingredientId: number;
  name: string;
  weekdays: IsoWeekday[];
  packs: number;
  label: string;
  unit: string;
  packWeight: number;
  packName: string | null;
  supplier: { id: number; name: string | null; orderFrequency: string | null; orderDays: string | null } | null;
};

type Draft = { weekdays: IsoWeekday[]; packs: number };

async function save(id: number, body: Draft): Promise<StandingOrderData> {
  const res = await fetch(url(id), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(res.status === 403 ? "Managers only" : b.error ?? `Couldn't save (${res.status})`);
  }
  return (await res.json()) as StandingOrderData;
}

export function StandingOrderField({ ingredientId, kanbanEnabled }: {
  ingredientId: number;
  /** Shown inside the kanban settings. With kanban off it still shows if a
   *  standing order is set, so a live setting is never hidden. */
  kanbanEnabled: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: queryKey(ingredientId),
    queryFn: async () => {
      const res = await fetch(url(ingredientId), { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load (${res.status})`);
      return (await res.json()) as StandingOrderData;
    },
  });

  const [enabled, setEnabled] = useState(false);
  const [weekdays, setWeekdays] = useState<IsoWeekday[]>([]);
  const [packs, setPacks] = useState(1);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded && q.isSuccess) {
      setEnabled(q.data.weekdays.length > 0 && q.data.packs > 0);
      setWeekdays(q.data.weekdays);
      setPacks(q.data.packs > 0 ? q.data.packs : 1);
      setLoaded(true);
    }
  }, [q.isSuccess, q.data, loaded]);

  const auto = useAutosave(async (draft: Draft) => {
    const saved = await save(ingredientId, draft);
    qc.setQueryData(queryKey(ingredientId), saved);
    // Today's Orders page may gain or lose the line.
    void qc.invalidateQueries({ queryKey: ["order-calculate"] });
  });

  const push = (next: { enabled?: boolean; weekdays?: IsoWeekday[]; packs?: number }, now = false) => {
    const on = next.enabled ?? enabled;
    const days = next.weekdays ?? weekdays;
    const p = next.packs ?? packs;
    // Off = no days; the packs are kept so switching back on restores them.
    auto.schedule({ weekdays: on ? days : [], packs: p });
    if (now) void auto.flush();
  };

  const toggle = (on: boolean) => { setEnabled(on); push({ enabled: on }, true); };
  const toggleDay = (d: IsoWeekday) => {
    const next = weekdays.includes(d) ? weekdays.filter(x => x !== d) : [...weekdays, d].sort((a, b) => a - b);
    setWeekdays(next);
    push({ weekdays: next }, true);
  };
  const changePacks = (n: number) => {
    const clean = Math.max(1, Math.min(MAX_STANDING_ORDER_PACKS, Math.round(n) || 1));
    setPacks(clean);
    push({ packs: clean });
  };

  if (q.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading weekly order…</div>;
  }
  if (q.isError) {
    return <p className="text-sm text-destructive">Couldn't load the weekly order setting. Close and reopen to try again.</p>;
  }
  // Kanban off and nothing set: nothing to show (it lives in kanban settings).
  if (!kanbanEnabled && !enabled) return null;

  const d = q.data!;
  const noun = packNoun(d.unit, packs, d.packName);
  const skipped = standingDaysSupplierSkips(weekdays, d.supplier);
  const label = standingOrderLabel(weekdays);

  return (
    <div className="rounded-2xl border-2 border-border bg-secondary/10 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <label className="relative inline-flex items-center cursor-pointer mt-0.5">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => toggle(e.target.checked)}
            className="sr-only peer"
            aria-label="Automatically order every week"
          />
          <div className="w-11 h-6 bg-gray-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
        <div className="flex-1 min-w-0">
          <span className="text-base font-bold flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary shrink-0" /> Automatically order every…
          </span>
          <p className="text-sm text-muted-foreground">
            Puts a fixed amount on the Orders page on the days you pick, whatever the stock — so nobody has to remember it. You still choose to order it or press &ldquo;Not today&rdquo;.
          </p>
        </div>
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
      </div>

      {enabled && (
        <>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {ISO_WEEKDAYS.map(day => {
              const on = weekdays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-pressed={on}
                  className={cn(
                    "h-14 rounded-xl border-2 text-base font-semibold transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary/40",
                  )}
                >
                  {WEEKDAY_SHORT[day]}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Order</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { changePacks(packs - 1); void auto.flush(); }}
                disabled={packs <= 1}
                aria-label="One fewer"
                className="h-14 w-14 rounded-xl border-2 border-border bg-background flex items-center justify-center disabled:opacity-40"
              >
                <Minus className="w-5 h-5" />
              </button>
              <input
                inputMode="numeric"
                value={packs}
                onChange={e => changePacks(Number(e.target.value.replace(/\D/g, "")))}
                onBlur={() => void auto.flush()}
                onFocus={e => e.currentTarget.select()}
                aria-label={`Number of ${packNoun(d.unit, 2, d.packName)}`}
                className="h-14 w-20 rounded-xl border-2 border-border bg-background text-center text-lg font-semibold tabular-nums"
              />
              <button
                type="button"
                onClick={() => { changePacks(packs + 1); void auto.flush(); }}
                aria-label="One more"
                className="h-14 w-14 rounded-xl border-2 border-border bg-background flex items-center justify-center"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
            <span className="text-sm font-medium">{noun}</span>
            {d.packWeight > 0 && (
              <span className="text-xs text-muted-foreground">(1 {packNoun(d.unit, 1, d.packName)} = {formatPackSize(d.packWeight, d.unit)})</span>
            )}
          </div>

          <div className="rounded-xl bg-background border border-border p-3 space-y-1">
            {weekdays.length === 0 ? (
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Pick at least one day — nothing is ordered until you do.</p>
            ) : (
              <p className="text-sm font-medium">
                {label}: {packs} {noun} on the {d.supplier?.name ?? "supplier"} order. If stock already needs more, the bigger amount is ordered — never both.
              </p>
            )}
            {!d.supplier && (
              <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" /> No supplier saved on this item yet — it can&rsquo;t go on an order without one.
              </p>
            )}
            {skipped.length > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {d.supplier?.name ?? "The supplier"} only takes orders on {d.supplier?.orderDays?.split(",").map(s => s.trim().slice(0, 3)).join(", ")}, so it won&rsquo;t come up on {skipped.map(x => WEEKDAY_SHORT[x]).join(" or ")}.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
