/**
 * End-of-week factory number on the Dispatch Orders panel's WEEK TOTAL
 * (Graeme, 16 Oct 2026). Objective C.
 *
 * Two numbers for Sunday night: calzone 2-packs left in the fridge if
 * nothing else sells, and predicted — less the further orders we'd normally
 * still get before each despatch's cut-off (the Create Plan factory-number
 * forecast). Maths: weekEndFactoryNumber in @workspace/stock-prediction.
 * Inputs: GET /api/week-end-stock, plus the orders already placed per day
 * from the same weekly-orders feed the panel's green bars draw.
 *
 * A finished week shows what it actually ended on (fridge change log).
 *
 * Three numbers (Graeme, 26 Oct 2026): what's in the fridge NOW; Sunday
 * predicted with the plans as they stand; and the best guess — every day
 * with no plan yet making what the kitchen could (the "could still make"
 * capacity forecast), late orders nudged by how sales are running.
 * "If no more orders" stays in the working, not as a headline.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { describeWeekEnd, formatEndPacks, weekEndFactoryNumber, type WeekEndLate } from "@workspace/stock-prediction";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ServerDay {
  date: string;
  deliveryDate: string;
  isDispatchDay: boolean;
  plannedPacks: number;
  hasPlan: boolean;
  late: (WeekEndLate & { samples: number; typicalDayPacks: number }) | null;
}

type WeekEndStockResponse =
  | { phase: "past"; weekStart: string; weekEnd: string; today: string; actualEnd: { packs: number; at: string } | null }
  | { phase: "too-far"; weekStart: string; weekEnd: string; today: string }
  | {
      phase: "current" | "future";
      weekStart: string; weekEnd: string; today: string; generatedAt: string;
      stock: { packs: number; countedAt: string | null } | null;
      stillToWrapToday: number;
      stillToDispatchToday: number | null;
      todayDispatchError: string | null;
      days: ServerDay[];
      sales?: { last7: number; normal7: number; ratio: number | null; factor: number };
      klaviyoConnected: boolean;
    };

const dayName = (d: string) => format(new Date(`${d}T12:00:00`), "EEE");

export function useWeekEndStock(weekStart: string, enabled: boolean) {
  return useQuery<WeekEndStockResponse>({
    queryKey: ["week-end-stock", weekStart],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/week-end-stock?weekStart=${encodeURIComponent(weekStart)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't work out the end of the week (${res.status})`);
      return res.json();
    },
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** The server inputs + the orders already placed, run through the shared maths. */
function useWeekEnd(weekStart: string, knownPacksByDate: ReadonlyMap<string, number>, ordersReady: boolean, couldMakeByDate?: Readonly<Record<string, number>>) {
  const { data, isLoading, error } = useWeekEndStock(weekStart, true);
  const result = useMemo(() => {
    if (!data || (data.phase !== "current" && data.phase !== "future") || !ordersReady) return null;
    return weekEndFactoryNumber({
      today: data.today,
      weekEnd: data.weekEnd,
      stockNow: data.stock?.packs ?? null,
      stillToWrapToday: data.stillToWrapToday,
      stillToDispatchToday: data.stillToDispatchToday,
      days: data.days.map(d => ({ ...d, knownOrderPacks: knownPacksByDate.get(d.date) ?? 0, couldMakePacks: couldMakeByDate?.[d.date] ?? 0 })),
      salesFactor: data.sales?.factor ?? 1,
    });
  }, [data, knownPacksByDate, ordersReady, couldMakeByDate]);
  return { data, result, isLoading, error };
}

function EndNumber({ packs, approx, label, sub }: { packs: number; approx?: boolean; label: string; sub?: string }) {
  const short = packs < 0;
  return (
    <div>
      <p className={cn("text-2xl sm:text-3xl font-display font-bold tabular-nums leading-tight", short ? "text-destructive" : "text-foreground")}>
        {short ? `−${Math.abs(packs).toLocaleString("en-GB")}` : `${approx ? "~" : ""}${packs.toLocaleString("en-GB")}`}
      </p>
      <p className={cn("text-xs leading-snug", short ? "text-destructive font-semibold" : "text-muted-foreground")}>
        {short ? `${label}: ${formatEndPacks(packs, approx)}` : label}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}

/**
 * @param knownPacksByDate  despatch date → packs on orders already placed
 *   (weekly-orders packCount) for every date from today to the week's Sunday.
 */
export function WeekEndStock({ weekStart, knownPacksByDate, ordersReady, couldMakeByDate }: {
  weekStart: string;
  knownPacksByDate: ReadonlyMap<string, number>;
  ordersReady: boolean;
  /** Plan date → packs the kitchen could make (unplanned days) — the panel's "could still make" bars. */
  couldMakeByDate?: Readonly<Record<string, number>>;
}) {
  const { data, result, isLoading, error } = useWeekEnd(weekStart, knownPacksByDate, ordersReady, couldMakeByDate);

  const shell = (children: React.ReactNode) => (
    <div className="w-full sm:w-auto rounded-xl border-2 border-border bg-secondary/40 p-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">End of week · in the fridge</p>
      {children}
    </div>
  );

  if (isLoading || (data && (data.phase === "current" || data.phase === "future") && !ordersReady)) {
    return shell(<p className="text-xs text-muted-foreground">Working it out…</p>);
  }
  if (error || !data) return shell(<p className="text-xs text-muted-foreground">Couldn't work out the end of the week.</p>);
  if (data.phase === "too-far") return null;
  if (data.phase === "past") {
    if (!data.actualEnd) return null;
    return shell(<EndNumber packs={data.actualEnd.packs} label="calzone packs at the end of Sunday (recorded)" />);
  }
  if (!result) return null;
  if (result.status !== "ok") return shell(<p className="text-xs text-muted-foreground leading-snug">{describeWeekEnd(result, dayName)}</p>);

  const sales = data.sales;
  const trend = sales?.ratio != null && Math.abs(sales.ratio - 1) >= 0.05
    ? `selling ${Math.round(Math.abs(sales.ratio - 1) * 100)}% ${sales.ratio > 1 ? "above" : "below"} normal this week`
    : "selling about as normal this week";
  return shell(
    <>
      {data.phase === "current" && result.stockNow != null && (
        <EndNumber packs={result.stockNow} label="in the fridge now" />
      )}
      {result.predicted != null ? (
        <EndNumber
          packs={result.predicted}
          approx
          label={result.unplannedDays.length ? "Sunday, with today's plans only" : "Sunday, predicted"}
          sub={result.expectedMore ? `after ~${result.expectedMore.toLocaleString("en-GB")} more ordered as normal` : "nothing more expected"}
        />
      ) : (
        <p className="text-xs text-muted-foreground leading-snug">
          No prediction for {result.predictionGap.map(dayName).join(", ")} — not enough order history.
        </p>
      )}
      {result.bestGuess != null && result.couldMake > 0 && (
        <div className="rounded-lg bg-primary/10 -mx-1 px-2 py-1.5">
          <EndNumber
            packs={result.bestGuess}
            approx
            label="Sunday, best guess"
            sub={`making the ~${result.couldMake.toLocaleString("en-GB")} we could on unplanned days · ${trend}`}
          />
        </div>
      )}
    </>,
  );
}

/** The plain line + the working, under the chart. */
export function WeekEndStockLine({ weekStart, knownPacksByDate, ordersReady, couldMakeByDate }: {
  weekStart: string;
  knownPacksByDate: ReadonlyMap<string, number>;
  ordersReady: boolean;
  couldMakeByDate?: Readonly<Record<string, number>>;
}) {
  const { data, result } = useWeekEnd(weekStart, knownPacksByDate, ordersReady, couldMakeByDate);

  if (!data) return null;
  if (data.phase === "past") {
    if (!data.actualEnd) return null;
    return (
      <p className="text-sm text-muted-foreground mt-3">
        Ended the week with <span className="font-semibold text-foreground">{data.actualEnd.packs.toLocaleString("en-GB")} calzone packs</span> in the fridge.
      </p>
    );
  }
  if (!result || (data.phase !== "current" && data.phase !== "future")) return null;
  if (result.status !== "ok") return <p className="text-sm text-muted-foreground mt-3">{describeWeekEnd(result, dayName)}</p>;

  const short = (result.predicted ?? result.ifNoMoreOrders ?? 0) < 0;
  const counted = data.stock?.countedAt ? formatDistanceToNowStrict(new Date(data.stock.countedAt), { addSuffix: true }) : null;
  const fmt = (n: number) => n.toLocaleString("en-GB");
  return (
    <div className="mt-3 text-sm">
      <p className={cn("font-medium", short ? "text-destructive" : "text-foreground")}>{describeWeekEnd(result, dayName)}</p>
      <details className="mt-1 text-muted-foreground">
        <summary className="cursor-pointer select-none text-xs hover:text-foreground">How it's worked out</summary>
        <ul className="mt-2 space-y-1 text-xs leading-snug max-w-prose">
          <li>
            <span className="font-semibold text-foreground tabular-nums">{fmt(result.stockNow ?? 0)}</span> calzone packs in the fridge now
            {counted ? ` (factory number, last counted ${counted})` : ""}
          </li>
          <li>
            + <span className="font-semibold text-foreground tabular-nums">{fmt(result.toMake)}</span> still to make this week
            {data.stillToWrapToday > 0 ? ` (incl. ${fmt(data.stillToWrapToday)} from today still to wrap)` : ""}, 8-pack bags left out
          </li>
          <li>
            − <span className="font-semibold text-foreground tabular-nums">{fmt(result.toDispatch)}</span> on orders already placed, still to go out
          </li>
          <li>
            = <span className="font-semibold text-foreground tabular-nums">{fmt(result.ifNoMoreOrders ?? 0)}</span> if no more orders
          </li>
          {result.expectedMore != null && (
            <li>
              − <span className="font-semibold text-foreground tabular-nums">~{fmt(result.expectedMore)}</span> more we'd normally sell before the remaining cut-offs
              {" "}(same forecast as Create Plan) = <span className="font-semibold text-foreground tabular-nums">~{fmt(result.predicted ?? 0)}</span>
              {result.predictedLow != null && result.predictedHigh != null && result.predictedLow !== result.predictedHigh
                ? `, likely ${fmt(result.predictedLow)} to ${fmt(result.predictedHigh)}`
                : ""}
            </li>
          )}
          {result.unplannedDays.length > 0 && (
            <li className="text-amber-600 dark:text-amber-400">
              No plan yet for {result.unplannedDays.map(dayName).join(", ")} — counted as nothing made in the figures above.
            </li>
          )}
          {result.bestGuess != null && result.couldMake > 0 && (
            <li>
              Best guess: + <span className="font-semibold text-foreground tabular-nums">~{fmt(result.couldMake)}</span> the team could make on
              the unplanned days (same Planday capacity as the "could make" bars), and the usual late orders
              {data.sales?.ratio != null
                ? ` × ${data.sales.factor.toFixed(2)} because the last 7 days sold ${fmt(data.sales.last7)} packs against a normal ${fmt(data.sales.normal7)} (half the difference, capped at 25%)`
                : ""}{" "}
              = <span className="font-semibold text-foreground tabular-nums">~{fmt(result.bestGuess)}</span>
              {result.bestGuessLow != null && result.bestGuessHigh != null && result.bestGuessLow !== result.bestGuessHigh
                ? `, likely ${fmt(result.bestGuessLow)} to ${fmt(result.bestGuessHigh)}`
                : ""}
            </li>
          )}
          {result.tightest && result.tightest.packs < 0 && (
            <li className="text-destructive font-medium">
              Lowest point: {dayName(result.tightest.date)}, {formatEndPacks(result.tightest.packs, result.predicted != null)}.
            </li>
          )}
          {!data.klaviyoConnected && <li>Klaviyo couldn't be read, so emails due aren't in the prediction.</li>}
        </ul>
      </details>
    </div>
  );
}
