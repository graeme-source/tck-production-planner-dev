/**
 * The factory floor map (Graeme, 2026-10-26): "a simple map based on [our
 * to-scale drawing] ... an information overview centre where I can see the
 * KPIs for the different sections, as well as who is on what station on
 * the current day."
 *
 * Areas are traced from the to-scale plan (1160 × 1240 units, 1 m ≈ 60).
 * Pure: the page draws these and hangs the live data on them; the matching
 * rules (rota station → area, sensor → area) are tested.
 */

export const PLAN_W = 1160;
export const PLAN_H = 1240;

export type AreaId =
  | "dough" | "building" | "ovens" | "wrapping" | "mixing" | "prep" | "wash" | "raw" | "sauce"
  | "prep_fridge" | "stairs" | "packing" | "product_fridge" | "product_freezer"
  | "goods_out" | "goods_in" | "storage";

/** Which live figure an area carries. */
export type AreaKpi = "run_rate" | "wrapping" | "packing" | "factory_number" | null;

export interface Area {
  id: AreaId;
  label: string;
  /** x, y, w, h in plan units. */
  rect: [number, number, number, number];
  kind: "room" | "cold" | "freezer" | "logistics" | "stairs";
  kpi: AreaKpi;
}

/** Laid out as the drawing: the production line runs along the top from the
 *  dough room (top right) through the building room to the ovens; wrapping
 *  down the left; packing, the product fridge and freezer at the bottom left;
 *  the prep block in the middle; storage & decant down the right. ("Clean
 *  storage" on the drawing is just storage — Graeme.) */
export const AREAS: readonly Area[] = [
  { id: "dough", label: "Dough room", rect: [848, 122, 238, 334], kind: "room", kpi: "run_rate" },
  { id: "building", label: "Building room", rect: [420, 122, 428, 168], kind: "room", kpi: "run_rate" },
  { id: "ovens", label: "Ovens", rect: [245, 122, 175, 168], kind: "room", kpi: "run_rate" },
  { id: "wrapping", label: "Wrapping", rect: [245, 290, 175, 415], kind: "room", kpi: "wrapping" },
  { id: "mixing", label: "Mixing", rect: [420, 290, 243, 170], kind: "room", kpi: "run_rate" },
  { id: "wash", label: "Wash room", rect: [663, 290, 172, 170], kind: "room", kpi: null },
  { id: "prep", label: "Prep", rect: [420, 460, 415, 100], kind: "room", kpi: null },
  { id: "raw", label: "Raw", rect: [420, 560, 180, 145], kind: "room", kpi: null },
  { id: "sauce", label: "Sauce & rub", rect: [600, 560, 235, 145], kind: "room", kpi: null },
  { id: "prep_fridge", label: "Prep fridge", rect: [542, 705, 160, 158], kind: "cold", kpi: null },
  { id: "stairs", label: "Stairs up", rect: [703, 705, 75, 160], kind: "stairs", kpi: null },
  { id: "packing", label: "Packing", rect: [245, 705, 297, 325], kind: "room", kpi: "packing" },
  { id: "product_fridge", label: "Product fridge", rect: [85, 722, 160, 308], kind: "cold", kpi: "factory_number" },
  { id: "product_freezer", label: "Product freezer", rect: [100, 1034, 296, 128], kind: "freezer", kpi: null },
  { id: "goods_out", label: "Goods out", rect: [585, 865, 155, 165], kind: "logistics", kpi: null },
  { id: "goods_in", label: "Goods in", rect: [740, 865, 100, 165], kind: "logistics", kpi: null },
  { id: "storage", label: "Storage & decant", rect: [845, 456, 241, 574], kind: "logistics", kpi: null },
];

/**
 * The morning meeting's rota stations ("Dough Prep", "Building Table 1",
 * "Packing" …, from the station-assignments mapping) onto map areas, by
 * name. Anything unmatched (Fried Chicken, a new title) is listed beside
 * the map rather than guessed onto it.
 */
export function areaForRotaStation(title: string): AreaId | null {
  const t = title.toLowerCase();
  if (/dough/.test(t)) return "dough";
  if (/build/.test(t)) return "building";
  if (/oven/.test(t)) return "ovens";
  if (/wrap/.test(t)) return "wrapping";
  if (/pack/.test(t)) return "packing";
  if (/mix/.test(t)) return "mixing";
  if (/wash|kp\b|pot/.test(t)) return "wash";
  if (/raw/.test(t)) return "raw";
  if (/sauce|rub/.test(t)) return "sauce";
  if (/decant|storage|goods/.test(t)) return "storage";
  if (/prep/.test(t)) return "prep";
  return null;
}

/** A Govee sensor's name onto the area it sits in ("Walk in Fridge 2026"
 *  is the product fridge, "Prep fridge (walk in)" the prep fridge …). */
export function areaForSensor(name: string): AreaId | null {
  const n = name.toLowerCase();
  if (/prep fridge/.test(n)) return "prep_fridge";
  if (/walk.?in freezer|product freezer/.test(n)) return "product_freezer";
  if (/walk.?in fridge|product fridge|production fridge/.test(n)) return "product_fridge";
  if (/mix/.test(n)) return "mixing";
  if (/build/.test(n)) return "building";
  if (/dough/.test(n)) return "dough";
  if (/raw/.test(n)) return "raw";
  if (/sauce|rub/.test(n)) return "sauce";
  if (/wrap/.test(n)) return "wrapping";
  if (/pack/.test(n)) return "packing";
  if (/prep/.test(n)) return "prep";
  return null;
}

/** "Bohdan Davydov" → "Bohdan D." — readable on a small room at a glance. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full.trim();
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/** % box for an area, for absolutely-positioned overlays. */
export function pctBox(rect: Area["rect"]) {
  const [x, y, w, h] = rect;
  return { left: `${(x / PLAN_W) * 100}%`, top: `${(y / PLAN_H) * 100}%`, width: `${(w / PLAN_W) * 100}%`, height: `${(h / PLAN_H) * 100}%` };
}

// ── Layers (Graeme, 2026-10-26: "turn on and off certain layers ... at some
// point we'll add all the fridges in ... on a separate layer ... a default
// view, but if I want more information, like fridges, it can show me that").
// A new layer is one entry here plus what it draws on the page.

export type LayerId = "labels" | "people" | "kpis" | "sensors";

export interface MapLayer {
  id: LayerId;
  label: string;
  /** On in the default view. */
  defaultOn: boolean;
  hint: string;
}

export const LAYERS: readonly MapLayer[] = [
  { id: "labels", label: "Room names", defaultOn: true, hint: "The name of each area" },
  { id: "people", label: "People", defaultOn: true, hint: "Who the rota puts on each section today" },
  { id: "kpis", label: "Live paces", defaultOn: true, hint: "Line run rate, wrapping and packing pace, factory number" },
  { id: "sensors", label: "Fridges & freezers", defaultOn: false, hint: "Live temperature sensors" },
];

export type LayerState = Record<LayerId, boolean>;

export function defaultLayers(): LayerState {
  return Object.fromEntries(LAYERS.map(l => [l.id, l.defaultOn])) as LayerState;
}

/** Saved choices over the defaults — a layer added later starts at its
 *  default; a saved layer that no longer exists is dropped. */
export function mergeLayers(saved: unknown): LayerState {
  const out = defaultLayers();
  if (saved && typeof saved === "object") {
    for (const l of LAYERS) {
      const v = (saved as Record<string, unknown>)[l.id];
      if (typeof v === "boolean") out[l.id] = v;
    }
  }
  return out;
}
