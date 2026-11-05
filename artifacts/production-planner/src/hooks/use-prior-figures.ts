/**
 * The figures a Numbers period is compared with (lib/numbers-benchmarks.ts).
 * A period running into today is cut to this time of day on its last day, so
 * today so far meets last week at this time, not last week's whole day.
 */
import { useSalesTrend } from "@/hooks/use-sales-trend";
import { addDays } from "@/lib/roas";
import { comparisonWindow, priorAtThisTime, priorFromTotals, type PriorFigures } from "@/lib/numbers-benchmarks";

export function usePriorFigures(
  win: { id: string; from: string; to: string; dayCount: number; includesToday: boolean; empty?: boolean },
  dayFraction: number,
): { prior: PriorFigures | null; compareLabel: string } {
  const cmp = comparisonWindow(win);
  const enabled = !win.empty;
  const singleDay = cmp.from === cmp.to;
  const wholeDaysTo = cmp.cutLastDay ? addDays(cmp.to, -1) : cmp.to;
  const whole = useSalesTrend(cmp.from, wholeDaysTo, null, enabled && !(cmp.cutLastDay && singleDay));
  const lastDay = useSalesTrend(cmp.to, cmp.to, "hour", enabled && cmp.cutLastDay);

  let prior: PriorFigures | null = null;
  if (!cmp.cutLastDay) {
    if (whole.data) prior = priorFromTotals(whole.data.totals);
  } else if (lastDay.data && (singleDay || whole.data)) {
    prior = priorAtThisTime(singleDay ? null : whole.data!.totals, lastDay.data.buckets, dayFraction);
  }
  return { prior, compareLabel: cmp.label };
}
