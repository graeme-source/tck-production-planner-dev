import type { FeatureDef } from "./types";

/**
 * Everything a person can be given access to, one entry each.
 *
 * THIS FILE IS THE LIBRARY. Add an entry here when you build something worth
 * gating and it appears in Settings → Team & Access → Feature grants on the
 * next deploy, ready to hand out — no migration, no admin data entry. The
 * server upserts these into app_features so grants have something to hang
 * off (lib/feature-sync.ts).
 *
 * Two rules:
 *  1. NEVER change a `key` that is live — grants are stored against it.
 *     Change the name and description freely; they're only labels.
 *  2. Don't list something the code doesn't actually check. A toggle that
 *     grants nothing is worse than no toggle: it looks like access was given
 *     when it wasn't. Every entry below is enforced — see `can()` in
 *     use-feature-access.ts and `userCan()` in lib/feature-access.ts.
 *
 * Page entries take their baseline from the access-level selector
 * (page_permissions), which an admin can change; `minRole` here is only the
 * fallback for a page with no row yet, and mirrors the built-in defaults.
 */
export const FEATURE_REGISTRY: FeatureDef[] = [
  // ── Pages ────────────────────────────────────────────────────────────────
  { key: "page.dashboard", name: "Dashboard", description: "The home screen.", area: "Pages", kind: "page", page: "/", minRole: "viewer" },
  { key: "page.plans", name: "Production Plans", description: "Build and run the day's plan.", area: "Pages", kind: "page", page: "/plans", minRole: "viewer" },
  { key: "page.recipes", name: "Recipes", description: "Recipes and their costings.", area: "Pages", kind: "page", page: "/recipes", minRole: "viewer" },
  { key: "page.sub_recipes", name: "Sub-Recipes", description: "Bases, sauces and marinades.", area: "Pages", kind: "page", page: "/sub-recipes", minRole: "viewer" },
  { key: "page.ingredients", name: "Ingredients", description: "The ingredient list and its costs.", area: "Pages", kind: "page", page: "/ingredients", minRole: "viewer" },
  { key: "page.suppliers", name: "Suppliers", description: "Supplier records, lead times and cutoffs.", area: "Pages", kind: "page", page: "/suppliers", minRole: "viewer" },
  { key: "page.stock", name: "Stock Inventory", description: "Stock counts and levels.", area: "Pages", kind: "page", page: "/stock", minRole: "viewer" },
  { key: "page.sales", name: "Sales Data", description: "Sales history and the numbers behind it.", area: "Pages", kind: "page", page: "/sales", minRole: "manager" },
  { key: "page.dispatches", name: "Dispatches", description: "What's going out and when.", area: "Pages", kind: "page", page: "/dispatches", minRole: "viewer" },
  // Keeps its original key: two people already hold this grant on live.
  { key: "apc_label_printing", name: "Order Packing Live", description: "The packing screen: scanning, booking and printing APC labels.", area: "Pages", kind: "page", page: "/fulfilment", minRole: "manager" },
  { key: "page.locations", name: "Bin Locations", description: "Where everything lives in the unit.", area: "Pages", kind: "page", page: "/locations", minRole: "admin" },
  { key: "page.dispatch_tag", name: "Dispatch Tagging", description: "Tagging orders for dispatch.", area: "Pages", kind: "page", page: "/dispatch-tag", minRole: "manager" },
  { key: "page.reports", name: "Reports", description: "Reports and the issue log.", area: "Pages", kind: "page", page: "/reports", minRole: "viewer" },
  { key: "page.kanbans", name: "Kanbans", description: "Kanban cards and the shelf-edge reorder loop.", area: "Pages", kind: "page", page: "/kanbans", minRole: "viewer" },
  { key: "page.product_hub", name: "Product Hub", description: "Product listings, decks and Shopify.", area: "Pages", kind: "page", page: "/product-hub", minRole: "viewer" },
  { key: "page.deliveries_receive", name: "Receive Deliveries (front door)", description: "Booking goods in at the door.", area: "Pages", kind: "page", page: "/deliveries/receive", minRole: "viewer" },
  { key: "page.training", name: "Training Matrix", description: "Who's trained on what.", area: "Pages", kind: "page", page: "/training", minRole: "manager" },
  { key: "page.lean_curriculum", name: "Lean Curriculum planner", description: "The weekly lesson plan behind the morning meeting.", area: "Pages", kind: "page", page: "/lean-curriculum", minRole: "manager" },
  { key: "page.surveys", name: "Customer Surveys", description: "Building and sending customer surveys.", area: "Pages", kind: "page", page: "/surveys", minRole: "admin" },

  // ── Settings areas ───────────────────────────────────────────────────────
  // "My Profile" isn't here on purpose — it's your own account, everyone has it.
  { key: "settings.team", name: "Team & Access", description: "People, roles, invites, page access and these very grants.", area: "Settings", kind: "settings", section: "team", minRole: "admin" },
  { key: "settings.production", name: "Production settings", description: "Targets, DPT, timings, oven and schedule defaults, factory number.", area: "Settings", kind: "settings", section: "production", minRole: "admin" },
  { key: "settings.packing", name: "Packing settings", description: "Packing checks, ice packs, APC service codes, fulfilment options.", area: "Settings", kind: "settings", section: "packing", minRole: "admin" },
  { key: "settings.storage", name: "Storage & Inventory settings", description: "Storage locations, category defaults and ingredient assignments.", area: "Settings", kind: "settings", section: "storage", minRole: "admin" },
  { key: "settings.sops", name: "Standards & SOPs", description: "The SOP and standards library behind the station links.", area: "Settings", kind: "settings", section: "sops", minRole: "admin" },
  { key: "settings.sensors", name: "Temperature Sensors", description: "Govee fridge and freezer sensors: pairing, mapping and alerts.", area: "Settings", kind: "settings", section: "sensors", minRole: "admin" },
  { key: "settings.features", name: "Feature flags & updates", description: "Global on/off switches, banner roles and the System Updates slides.", area: "Settings", kind: "settings", section: "features", minRole: "admin" },
];

const BY_KEY = new Map(FEATURE_REGISTRY.map(f => [f.key, f]));
const BY_PAGE = new Map(
  FEATURE_REGISTRY.filter(f => f.kind === "page" && f.page).map(f => [f.page as string, f]),
);
const BY_SECTION = new Map(
  FEATURE_REGISTRY.filter(f => f.kind === "settings" && f.section).map(f => [f.section as string, f]),
);

export function featureByKey(key: string): FeatureDef | undefined {
  return BY_KEY.get(key);
}

/** The feature a page route sits behind, if any. */
export function featureForPage(page: string): FeatureDef | undefined {
  return BY_PAGE.get(page);
}

/** The feature a Settings section sits behind, if any. */
export function featureForSection(section: string): FeatureDef | undefined {
  return BY_SECTION.get(section);
}

/** { "/fulfilment": "apc_label_printing", … } — the old hand-written map, derived. */
export function pageFeatureMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of FEATURE_REGISTRY) if (f.kind === "page" && f.page) map[f.page] = f.key;
  return map;
}

/** Registry grouped for the grants screen, areas in a stable order. */
export function featuresByArea(): Array<{ area: string; features: FeatureDef[] }> {
  const order: string[] = [];
  const groups = new Map<string, FeatureDef[]>();
  for (const f of FEATURE_REGISTRY) {
    if (!groups.has(f.area)) { groups.set(f.area, []); order.push(f.area); }
    groups.get(f.area)!.push(f);
  }
  return order.map(area => ({ area, features: groups.get(area)! }));
}
