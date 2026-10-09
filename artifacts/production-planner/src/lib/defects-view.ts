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
  byDay: Array<{ date: string; defects: number; packsMade: number; pct: number | null; wasteCost: number }>;
  /** £ of waste in the range (entries with a cost). */
  waste: { entries: number; ingredientCost: number; timeCost: number; totalCost: number };
}

export interface DefectType { id: number; name: string; active: boolean; sortOrder: number }

export type WasteItemKind = "ingredient" | "sub_recipe" | "product";
export type PackKind = "pack" | "eight_pack_bag";

/** One thing that can be wasted (GET /api/defects/items). */
export interface WasteItem {
  key: string;
  kind: WasteItemKind;
  id: number;
  name: string;
  detail: string | null;
  units: string[];
  packKinds: Array<{ kind: PackKind; label: string }>;
  standardPrepMinutes: number | null;
}

/** The live cost (POST /api/defects/waste-cost). */
export interface WasteCost {
  itemName: string;
  packs: number;
  suggestedMinutes: number | null;
  remakeMinutes: number;
  ingredientCost: number | null;
  timeCost: number | null;
  totalCost: number | null;
  hourlyRate: number | null;
  hourlyRateFrom: string | null;
  hourlyRateTo: string | null;
}

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
  // Waste (2026-10-09). All null on records from before then.
  itemKind: WasteItemKind | null;
  ingredientId: number | null;
  subRecipeId: number | null;
  packKind: PackKind | null;
  itemName: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  remakeMinutes: number | null;
  ingredientCost: number | null;
  timeCost: number | null;
  totalCost: number | null;
}

const nf = new Intl.NumberFormat("en-GB");
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

/** "£13.62", or "—" when it couldn't be priced. */
export function gbpText(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : money.format(n);
}

/** "45 min", "1 h 30 min", "2 h". */
export function minutesText(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/** "2.3 kg", "3 × 2-pack", "1 × 8-pack bag", "12 each". */
export function quantityText(
  r: Pick<DefectRecord, "quantity" | "quantityUnit" | "packKind">,
  packLabel?: string | null,
): string | null {
  if (r.quantity == null || !r.quantityUnit) return null;
  const q = nf.format(r.quantity);
  if (r.quantityUnit === "pack") return `${q} × ${packLabel ?? "pack"}`;
  if (r.quantityUnit === "bag") return `${q} × 8-pack bag`;
  return `${q} ${r.quantityUnit}`;
}

/** An amount as typed — "2.3", "2,3", " 500 " — or null when it isn't a
 *  positive number. Whole numbers only when `whole` (packs, bags). */
export function parseAmount(text: string, whole = false): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const n = Number(t);
  if (!(n > 0) || n > 100000) return null;
  if (whole && !Number.isInteger(n)) return null;
  return n;
}

/** The item a record is about: the waste item, or (older records) its recipe. */
export function recordItemName(r: Pick<DefectRecord, "itemName" | "recipeName">): string | null {
  return r.itemName ?? r.recipeName ?? null;
}

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
