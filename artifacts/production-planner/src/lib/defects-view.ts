/**
 * Defects page — display helpers (pure; tested in defects-view.test.ts).
 * The numbers themselves are worked out by the API (lib/defects-kpi.ts);
 * this file only turns them into words.
 */

export interface DefectSummary {
  from: string;
  to: string;
  defects: number;
  packsMade: number;
  pct: number | null;
  wonky: number;
  dogBin: number;
  recorded: number;
  byType: Array<{ key: string; label: string; packs: number }>;
  byStation: Array<{ station: string | null; packs: number }>;
  byDay: Array<{ date: string; defects: number; packsMade: number; pct: number | null }>;
}

export interface DefectType { id: number; name: string; active: boolean; sortOrder: number }

export interface DefectRecord {
  id: number;
  occurredOn: string;
  defectTypeId: number;
  typeName: string;
  recipeId: number | null;
  recipeName: string | null;
  packs: number;
  station: string | null;
  orderRefs: string | null;
  note: string | null;
  recordedById: number | null;
  recordedByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

const nf = new Intl.NumberFormat("en-GB");

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${nf.format(n)} ${n === 1 ? one : many}`;
}

/** "1.2%", or "—" when nothing was made (a 0% there would look perfect). */
export function pctText(pct: number | null): string {
  return pct == null ? "—" : `${pct.toFixed(1)}%`;
}

/** "14 defects · 1.2% of 1,180 packs" — the KPI in one line. */
export function defectHeadline(s: Pick<DefectSummary, "defects" | "packsMade" | "pct">): string {
  const first = plural(s.defects, "defect");
  if (s.pct == null) return `${first} · no packs made`;
  return `${first} · ${pctText(s.pct)} of ${plural(s.packsMade, "pack")}`;
}

/** Label for a station key, falling back to the text as typed. */
export function stationText(station: string | null, labels: Record<string, string>): string {
  if (!station) return "Not recorded";
  return labels[station] ?? station;
}

/** "Wed 30 Sep" (adds the year when it isn't this year's). */
export function dayText(iso: string, today: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" };
  if (iso.slice(0, 4) !== today.slice(0, 4)) opts.year = "numeric";
  return d.toLocaleDateString("en-GB", opts);
}

/** "30 Sep – 1 Oct" or a single day. */
export function rangeText(from: string, to: string, today: string): string {
  return from === to ? dayText(from, today) : `${dayText(from, today)} – ${dayText(to, today)}`;
}

/** Order refs as typed ("#136117, 136112") → tidy list of "#136117". */
export function orderRefList(refs: string | null): string[] {
  if (!refs) return [];
  return refs.split(/[\s,;]+/).map(r => r.trim()).filter(Boolean).map(r => (r.startsWith("#") ? r : `#${r}`));
}

/** Share of the largest bar, for breakdown bars (0–100). */
export function barWidth(packs: number, max: number): number {
  if (!(max > 0) || !(packs > 0)) return 0;
  return Math.max(4, Math.round((packs / max) * 100));
}
