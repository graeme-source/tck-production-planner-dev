import { londonDateString } from "../london-time";
import { COVERAGE_LABEL, USAGE_SOURCE_LABEL, type UsageCoverage, type UsageEvent, type UsageSource } from "../stock-ledger";
import { addDaysIso, daysBetween, weekStart } from "../team-efficiency-labour";

// What AI Jane says about real ingredient usage. The usage events themselves
// come from the running-stock ledger, the same figures Orders and Stock
// accuracy use; this only totals them by week. Pure, unit-tested.

export const MOST_WEEKS = 26;

export interface UsagePeriod { from: string; to: string }

/** The last N finished Monday-to-Sunday weeks: a half-finished week would
 *  drag every average down. */
export function lastFullWeeks(today: string, weeks: number): UsagePeriod {
  const thisMonday = weekStart(today);
  return { from: addDaysIso(thisMonday, -7 * weeks), to: addDaysIso(thisMonday, -1) };
}

const tidy = (n: number) => Math.round(n * 100) / 100;

export interface UsageSummaryInput {
  ingredient: { name: string; unit: string; packWeight: number | null };
  coverage: UsageCoverage;
  usage: UsageEvent[];
  period: UsagePeriod;
}

export function summariseUsage({ ingredient, coverage, usage, period }: UsageSummaryInput) {
  const weeks = new Map<string, number>();
  for (let monday = weekStart(period.from); monday <= period.to; monday = addDaysIso(monday, 7)) weeks.set(monday, 0);
  const bySource = new Map<UsageSource, number>();
  const days = new Set<string>();
  let total = 0;

  for (const event of usage) {
    const day = londonDateString(new Date(event.at));
    if (day < period.from || day > period.to) continue;
    total += event.qty;
    days.add(day);
    bySource.set(event.source, (bySource.get(event.source) ?? 0) + event.qty);
    const monday = weekStart(day);
    weeks.set(monday, (weeks.get(monday) ?? 0) + event.qty);
  }

  const weeksInPeriod = (daysBetween(period.from, period.to) + 1) / 7;
  const averagePerWeek = weeksInPeriod > 0 ? total / weeksInPeriod : 0;
  const { packWeight } = ingredient;

  return {
    ingredient: ingredient.name,
    unit: ingredient.unit,
    from: period.from,
    to: period.to,
    weeks: tidy(weeksInPeriod),
    totalUsed: tidy(total),
    averagePerWeek: tidy(averagePerWeek),
    daysUsed: days.size,
    packSize: packWeight,
    averagePacksPerWeek: packWeight ? tidy(averagePerWeek / packWeight) : null,
    byWeek: [...weeks].map(([weekStarting, used]) => ({ weekStarting, used: tidy(used) })),
    wentOn: [...bySource].map(([source, used]) => ({ on: USAGE_SOURCE_LABEL[source], used: tidy(used) })),
    howTracked: COVERAGE_LABEL[coverage],
    coverage,
  };
}
