/**
 * Defects KPI — one building-wide figure (Graeme, 2026-10-01; Objective E).
 * Pure, no I/O: routes/defects.ts loads the numbers and calls this.
 *
 * A defect is any process not carried out correctly that ends in product
 * not acceptable for normal despatch. Three sources, all counted in PACKS:
 *
 *   - Wonkies   — production_plan_items.wonly_total (sumQualityRejects)
 *   - Dog bins  — production_plan_items.dog_bin_count (sumQualityRejects)
 *   - Recorded  — rows in the defects table (mislabels, wrong items, …)
 *
 * Wonkies and dog bins are counted automatically from the station taps —
 * nobody re-enters them. KPI = defect packs ÷ packs made, where packs made
 * is the Team efficiency figure (totalPacksMade in team-efficiency-day.ts).
 *
 * Days are London calendar days. For wonkies, dog bins and packs made the
 * day is the production plan's date (the same keying the end-of-day
 * meeting uses); for recorded defects it is the day it happened.
 *
 * No type, recipe or station names in here — types are data (defect_types);
 * "wonky" and "dog_bin" are the existing quality-reject kinds.
 */
import { addDaysIso, weekStart } from "./team-efficiency-labour";
import { REJECT_LABELS } from "./quality-rejects";

export interface DefectDayInput {
  date: string;
  /** Packs made that day (totalPacksMade). */
  packsMade: number;
  wonky: number;
  dogBin: number;
}

export interface RecordedDefectInput {
  occurredOn: string;
  typeId: number;
  /** 0 for waste that isn't packs (a kilo of sauce). */
  packs: number;
  station: string | null;
  /** Waste cost snapshot (migration 0152); null/absent on old records. */
  ingredientCost?: number | null;
  timeCost?: number | null;
}

/** £ of waste over a range: ingredients, remake time, and the two together. */
export interface WasteTotals {
  /** Entries with a cost. */
  entries: number;
  ingredientCost: number;
  timeCost: number;
  totalCost: number;
}

export interface DefectTypeInput {
  id: number;
  name: string;
  active: boolean;
  sortOrder: number;
}

/** Net taps per station for one kind over the range (sum of +1 / −1). */
export interface RejectStationInput {
  kind: "wonky" | "dog_bin";
  station: string | null;
  packs: number;
}

export interface DefectBreakdownRow {
  /** "wonky" | "dog_bin" | "type:<id>" */
  key: string;
  label: string;
  packs: number;
}

export interface DefectStationRow {
  /** Station key or free text; null = not recorded. */
  station: string | null;
  packs: number;
}

export interface DefectDayRow {
  date: string;
  defects: number;
  packsMade: number;
  pct: number | null;
  /** £ of waste that day (ingredients + time). */
  wasteCost: number;
}

export interface DefectSummary {
  from: string;
  to: string;
  defects: number;
  packsMade: number;
  /** defects ÷ packs made × 100, one decimal; null when nothing was made. */
  pct: number | null;
  wonky: number;
  dogBin: number;
  recorded: number;
  byType: DefectBreakdownRow[];
  byStation: DefectStationRow[];
  byDay: DefectDayRow[];
  waste: WasteTotals;
}

/** Percentage to one decimal; null when there's no denominator (a zero
 *  would read as "perfect" on a day nothing was made). */
export function defectPct(defects: number, packsMade: number): number | null {
  if (!(packsMade > 0)) return null;
  return Math.round((defects / packsMade) * 1000) / 10;
}

/** Every date from..to inclusive. */
export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/** The standard periods: today, this week (Monday on), this month (1st on). */
export function standardPeriods(today: string): Record<"today" | "week" | "month", { from: string; to: string }> {
  return {
    today: { from: today, to: today },
    week: { from: weekStart(today), to: today },
    month: { from: `${today.slice(0, 7)}-01`, to: today },
  };
}

/**
 * Where wonkies and dog bins went wrong. Each tap logs its station
 * (quality_reject_events), but the counters on production_plan_items are the
 * source of truth and taps before migration 0131 have no trail. So: credit
 * stations with their net taps, never more than the counter total, and put
 * whatever the trail can't explain under "not recorded" (null).
 */
export function attributeRejectStations(
  totals: { wonky: number; dogBin: number },
  events: RejectStationInput[],
): DefectStationRow[] {
  const out: DefectStationRow[] = [];
  for (const kind of ["wonky", "dog_bin"] as const) {
    let left = Math.max(0, kind === "wonky" ? totals.wonky : totals.dogBin);
    const byStation = new Map<string, number>();
    for (const e of events) {
      if (e.kind !== kind || !e.station) continue;
      byStation.set(e.station, (byStation.get(e.station) ?? 0) + e.packs);
    }
    const ordered = [...byStation.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [station, n] of ordered) {
      const take = Math.min(n, left);
      if (take <= 0) break;
      out.push({ station, packs: take });
      left -= take;
    }
    if (left > 0) out.push({ station: null, packs: left });
  }
  return out;
}

function mergeStations(rows: DefectStationRow[]): DefectStationRow[] {
  const m = new Map<string | null, number>();
  for (const r of rows) m.set(r.station, (m.get(r.station) ?? 0) + r.packs);
  return [...m.entries()]
    .filter(([, n]) => n > 0)
    .map(([station, packs]) => ({ station, packs }))
    // Biggest first; "not recorded" always last so it never heads the list.
    .sort((a, b) => (a.station === null ? 1 : 0) - (b.station === null ? 1 : 0) || b.packs - a.packs || String(a.station).localeCompare(String(b.station)));
}

export function summariseDefects(input: {
  from: string;
  to: string;
  days: DefectDayInput[];
  recorded: RecordedDefectInput[];
  types: DefectTypeInput[];
  rejectStations: RejectStationInput[];
}): DefectSummary {
  const { from, to } = input;
  const inRange = (d: string) => d >= from && d <= to;
  const days = input.days.filter(d => inRange(d.date));
  const allRecorded = input.recorded.filter(r => inRange(r.occurredOn));
  // Packs count only records of packs; waste by weight is £, not packs.
  const recorded = allRecorded.filter(r => r.packs > 0);
  const waste = sumWaste(allRecorded);
  const wasteByDate = new Map<string, number>();
  for (const r of allRecorded) {
    const t = (r.ingredientCost ?? 0) + (r.timeCost ?? 0);
    if (t > 0) wasteByDate.set(r.occurredOn, pennies((wasteByDate.get(r.occurredOn) ?? 0) + t));
  }

  const wonky = days.reduce((n, d) => n + Math.max(0, d.wonky), 0);
  const dogBin = days.reduce((n, d) => n + Math.max(0, d.dogBin), 0);
  const packsMade = days.reduce((n, d) => n + Math.max(0, d.packsMade), 0);
  const recordedPacks = recorded.reduce((n, r) => n + r.packs, 0);
  const defects = wonky + dogBin + recordedPacks;

  // By type: the two reject kinds, then every recorded type in its order.
  // Active types show even at zero (so the list doesn't jump about);
  // switched-off types only when they have records in the range.
  const perType = new Map<number, number>();
  for (const r of recorded) perType.set(r.typeId, (perType.get(r.typeId) ?? 0) + r.packs);
  const byType: DefectBreakdownRow[] = [
    { key: "wonky", label: REJECT_LABELS.wonky.name, packs: wonky },
    { key: "dog_bin", label: REJECT_LABELS.dog_bin.name, packs: dogBin },
  ];
  const knownTypes = new Set<number>();
  for (const t of [...input.types].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)) {
    knownTypes.add(t.id);
    const packs = perType.get(t.id) ?? 0;
    if (t.active || packs > 0) byType.push({ key: `type:${t.id}`, label: t.name, packs });
  }
  for (const [id, packs] of perType) {
    if (!knownTypes.has(id)) byType.push({ key: `type:${id}`, label: "Other", packs });
  }

  const byStation = mergeStations([
    ...attributeRejectStations({ wonky, dogBin }, input.rejectStations),
    ...recorded.map(r => ({ station: r.station?.trim() || null, packs: r.packs })),
  ]);

  const dayMap = new Map(days.map(d => [d.date, d]));
  const recordedByDay = new Map<string, number>();
  for (const r of recorded) recordedByDay.set(r.occurredOn, (recordedByDay.get(r.occurredOn) ?? 0) + r.packs);
  const byDay: DefectDayRow[] = datesInRange(from, to).map(date => {
    const d = dayMap.get(date);
    const made = Math.max(0, d?.packsMade ?? 0);
    const n = Math.max(0, d?.wonky ?? 0) + Math.max(0, d?.dogBin ?? 0) + (recordedByDay.get(date) ?? 0);
    return { date, defects: n, packsMade: made, pct: defectPct(n, made), wasteCost: wasteByDate.get(date) ?? 0 };
  });

  return {
    from, to, defects, packsMade, pct: defectPct(defects, packsMade),
    wonky, dogBin, recorded: recordedPacks, byType, byStation, byDay, waste,
  };
}

const pennies = (n: number) => Math.round(n * 100) / 100;

/** £ of the recorded waste: ingredients, remake time, total. Old records
 *  (no cost) add nothing. */
export function sumWaste(rows: Array<Pick<RecordedDefectInput, "ingredientCost" | "timeCost">>): WasteTotals {
  let entries = 0;
  let ingredientCost = 0;
  let timeCost = 0;
  for (const r of rows) {
    if (r.ingredientCost == null && r.timeCost == null) continue;
    entries++;
    ingredientCost += r.ingredientCost ?? 0;
    timeCost += r.timeCost ?? 0;
  }
  return { entries, ingredientCost: pennies(ingredientCost), timeCost: pennies(timeCost), totalCost: pennies(ingredientCost + timeCost) };
}

/** Who may change or delete a recorded defect: managers, admins, and the
 *  person who recorded it. Anyone signed in may record one. */
export function canEditDefect(
  user: { id: number | null | undefined; role: string | null | undefined },
  defect: { recordedById: number | null },
): boolean {
  if (user.role === "admin" || user.role === "manager") return true;
  return user.id != null && defect.recordedById != null && user.id === defect.recordedById;
}
