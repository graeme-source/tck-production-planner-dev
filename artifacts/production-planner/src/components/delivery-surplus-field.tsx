/**
 * Surplus by delivery day (Graeme, 14 Oct 2026). Objective C.
 *
 * "Different surplus depending on delivery day": a % for each weekday the
 * delivery ARRIVES (blank = the normal surplus). The person never works out
 * order days — the preview maps them from the supplier's real lead time:
 * "Orders placed Fri → delivered Mon: 130% · Mon → Tue: 130% · …".
 *
 * Autosaves with a visible save state on its own endpoint
 * (GET/PUT /api/ingredients/:id/surplus-by-delivery-day), so it never waits
 * for the ingredient dialog's Save. The order engine reads the setting only
 * through surplusFor (@workspace/business-days).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Loader2 } from "lucide-react";
import {
  ISO_WEEKDAYS,
  WEEKDAY_SHORT,
  MAX_DAY_SURPLUS_PERCENT,
  deliverySurplusPreview,
  describeDeliverySurplus,
  unreachableDeliveryWeekdays,
  parseSurplusByDeliveryWeekday,
  type IsoWeekday,
  type SurplusByDeliveryWeekday,
} from "@workspace/business-days";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const url = (id: number) => `${BASE}/api/ingredients/${id}/surplus-by-delivery-day`;

type DeliverySurplusData = {
  ingredientId: number;
  surplusPercent: number;
  surplusMode: "percent" | "absolute";
  byWeekday: SurplusByDeliveryWeekday | null;
  supplier: { id: number; name: string | null; leadTimeDays: number; cutoffTime: string } | null;
};

const queryKey = (id: number) => ["ingredient-delivery-surplus", id] as const;

async function saveByWeekday(id: number, byWeekday: SurplusByDeliveryWeekday | null): Promise<DeliverySurplusData> {
  const res = await fetch(url(id), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ byWeekday }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(res.status === 403 ? "Managers only" : body.error ?? `Couldn't save (${res.status})`);
  }
  return (await res.json()) as DeliverySurplusData;
}

type DayText = Record<IsoWeekday, string>;
const EMPTY: DayText = { 1: "", 2: "", 3: "", 4: "", 5: "", 6: "", 7: "" };

function toText(map: SurplusByDeliveryWeekday | null): DayText {
  const out = { ...EMPTY };
  for (const d of ISO_WEEKDAYS) if (map?.[d] != null) out[d] = String(map[d]);
  return out;
}

/** A day's text is valid when blank or a number 0–1000. */
function dayValid(t: string): boolean {
  if (t.trim() === "") return true;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= MAX_DAY_SURPLUS_PERCENT;
}

export function DeliverySurplusField({ ingredientId, normalPercent }: {
  ingredientId: number;
  /** The normal Surplus % as currently typed in the dialog (preview only). */
  normalPercent: number | string | null | undefined;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: queryKey(ingredientId),
    queryFn: async () => {
      const res = await fetch(url(ingredientId), { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load (${res.status})`);
      return (await res.json()) as DeliverySurplusData;
    },
  });

  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState<DayText>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded && q.isSuccess) {
      setEnabled(q.data.byWeekday != null);
      setText(toText(q.data.byWeekday));
      setLoaded(true);
    }
  }, [q.isSuccess, q.data, loaded]);

  const auto = useAutosave(async (byWeekday: SurplusByDeliveryWeekday | null) => {
    const saved = await saveByWeekday(ingredientId, byWeekday);
    qc.setQueryData(queryKey(ingredientId), saved);
    // The Orders page's suggestions depend on it.
    void qc.invalidateQueries({ queryKey: ["orders"] });
  });

  const lead = q.data?.supplier?.leadTimeDays ?? 1;
  const cutoff = q.data?.supplier?.cutoffTime ?? "17:00";
  const basePercent = Number(normalPercent) || q.data?.surplusPercent || 10;
  const map = useMemo(() => parseSurplusByDeliveryWeekday(text), [text]);
  const unreachable = useMemo(() => new Set(unreachableDeliveryWeekdays(lead)), [lead]);
  const preview = useMemo(
    () => describeDeliverySurplus(deliverySurplusPreview({ surplusPercent: basePercent, surplusByDeliveryWeekday: map }, lead)),
    [basePercent, map, lead],
  );

  const changeDay = (day: IsoWeekday, raw: string) => {
    const clean = raw.replace(/[^\d.]/g, "").slice(0, 6);
    const next = { ...text, [day]: clean };
    setText(next);
    if (ISO_WEEKDAYS.every(d => dayValid(next[d]))) auto.schedule(parseSurplusByDeliveryWeekday(next));
  };

  const toggle = (on: boolean) => {
    setEnabled(on);
    // Off = normal surplus every day; the typed days stay on screen until
    // the dialog closes, so switching back on restores them.
    auto.schedule(on ? parseSurplusByDeliveryWeekday(text) : null);
    void auto.flush();
  };

  if (q.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading delivery-day surplus…</div>;
  }
  if (q.isError) {
    return <p className="text-sm text-destructive">Couldn't load the delivery-day surplus. Close and reopen to try again.</p>;
  }

  return (
    <div className="rounded-2xl border-2 border-border bg-secondary/10 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <label className="relative inline-flex items-center cursor-pointer mt-0.5">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => toggle(e.target.checked)}
            className="sr-only peer"
            aria-label="Different surplus depending on delivery day"
          />
          <div className="w-11 h-6 bg-gray-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
        <div className="flex-1 min-w-0">
          <span className="text-base font-bold flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary shrink-0" /> Different surplus depending on delivery day
          </span>
          <p className="text-sm text-muted-foreground">
            Set the surplus for the day a delivery <strong>arrives</strong>. Leave a day blank to use the normal {basePercent}%.
          </p>
        </div>
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
      </div>

      {enabled && (
        <>
          {q.data?.surplusMode === "absolute" && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              This ingredient uses a fixed surplus quantity, so these percentages won't be used until it's back on a % surplus.
            </p>
          )}
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {ISO_WEEKDAYS.map(day => {
              const valid = dayValid(text[day]);
              const never = unreachable.has(day);
              return (
                <label key={day} className="flex flex-col items-center gap-1">
                  <span className={cn("text-sm font-semibold", never && "text-muted-foreground")}>{WEEKDAY_SHORT[day]}</span>
                  <div className="relative w-full">
                    <input
                      inputMode="decimal"
                      value={text[day]}
                      onChange={e => changeDay(day, e.target.value)}
                      onBlur={() => void auto.flush()}
                      onFocus={e => e.currentTarget.select()}
                      placeholder={String(basePercent)}
                      aria-label={`Surplus for ${WEEKDAY_SHORT[day]} deliveries`}
                      className={cn(
                        "w-full h-14 rounded-xl border-2 bg-background text-center text-lg font-semibold tabular-nums pr-5",
                        valid ? "border-border" : "border-destructive",
                        never && "opacity-60",
                      )}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">%</span>
                  </div>
                </label>
              );
            })}
          </div>
          {!ISO_WEEKDAYS.every(d => dayValid(text[d])) && (
            <p className="text-sm text-destructive">Each day must be blank or a number from 0 to {MAX_DAY_SURPLUS_PERCENT}. Not saved until fixed.</p>
          )}
          <div className="rounded-xl bg-background border border-border p-3 space-y-1">
            <p className="text-sm font-medium">{preview}</p>
            <p className="text-xs text-muted-foreground">
              {q.data?.supplier
                ? <>From {q.data.supplier.name ?? "the supplier"}&rsquo;s {lead}-working-day lead time, ordering before the {cutoff} cut-off. After the cut-off the delivery moves a day later and that day&rsquo;s surplus is used.</>
                : <>No supplier set — assuming next-working-day delivery.</>}
              {unreachable.size > 0 && <> No order lands on {[...unreachable].map(d => WEEKDAY_SHORT[d]).join(" or ")}, so those days are never used.</>}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
