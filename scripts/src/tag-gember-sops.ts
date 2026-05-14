/**
 * Apply station assignments + semantic tags to the imported Gember SOPs.
 *
 * Looks up each SOP by its `ref:<slug>` tag (set by import-gember-sops.ts) and
 * UPDATEs `stations` + `tags`. Internal bookkeeping tags (`imported:gembadocs`,
 * `ref:<slug>`) are preserved — they stay on the row for idempotency and the
 * push-to-live script.
 *
 * Re-runs are idempotent: stations + semantic tags are overwritten from this
 * file each run. Edit the MAPPINGS table to tweak.
 *
 * Usage:
 *   DATABASE_URL=postgresql://localhost/tck_planner \
 *     pnpm --filter @workspace/scripts run tag-gember-sops
 */

import pg from "pg";

// ─── Station keys (must match @/pages/station/shared/constants) ─────────────
type Station =
  | "dough_prep"
  | "dough_sheeting"
  | "macaroni_cheese"
  | "prep"
  | "prep_bases"
  | "prep_meat"
  | "main_prep"
  | "mixing"
  | "building_1"
  | "building_2"
  | "ovens"
  | "wrapping"
  | "packing";

// Shorthand: the building tables are conceptually the same workstation for
// SOP-reference purposes. The picker UI groups them; we tag both real keys
// so either station-filtered view will pick them up.
const BUILDING: Station[] = ["building_1", "building_2"];

interface Mapping {
  stations: Station[];
  tags: string[];
}

// ─── slug → { stations, tags } ──────────────────────────────────────────────
// Hand-curated for accuracy on the 132 Gember SOPs. Empty `stations` means
// the SOP isn't tied to a production station (admin / office / culture).
//
// Tag vocabulary:
//   cleaning, delivery, labels, equipment, safety, stock-check, shopify,
//   office, kanban, training, culture, seasonal
const MAPPINGS: Record<string, Mapping> = {
  // ── Dough prep ─────────────────────────────────────────────────────────
  "chill-2-buckets-flour-water-containers-10-kg": { stations: ["dough_prep"], tags: [] },
  "chill-flour-for-next-days-production": { stations: ["dough_prep"], tags: [] },
  "dough-chilling": { stations: ["dough_prep"], tags: [] },
  "dough-chilling-cabinet": { stations: ["dough_prep"], tags: ["equipment"] },
  "dough-prooving": { stations: ["dough_prep"], tags: [] },
  "fold-dough-ready-to-take-to-the-building-table": { stations: ["dough_prep"], tags: [] },
  "making-a-dough-mix": { stations: ["dough_prep"], tags: [] },
  "packing-dough-team": { stations: ["dough_prep"], tags: [] },
  "scrape-down-and-pre-soak-dough-trays": { stations: ["dough_prep"], tags: ["cleaning"] },
  "standard-dough": { stations: ["dough_prep"], tags: [] },
  "standard-dough-november-25": { stations: ["dough_prep"], tags: [] },

  // ── Dough sheeting ─────────────────────────────────────────────────────
  "dough-sheeter-dry-clean": { stations: ["dough_sheeting"], tags: ["cleaning", "equipment"] },
  "dough-sheeter-wet-clean": { stations: ["dough_sheeting"], tags: ["cleaning", "equipment"] },
  "putting-dough-onto-sheeter": { stations: ["dough_sheeting"], tags: [] },
  "setting-up-dough-sheeter": { stations: ["dough_sheeting"], tags: ["equipment"] },
  "sheeting-dough": { stations: ["dough_sheeting"], tags: [] },
  "turn-dial-on-sheeter-to-2-5-3-0-pass-dough-through": { stations: ["dough_sheeting"], tags: [] },
  "turn-dial-on-sheeter-to-8-5-9-0": { stations: ["dough_sheeting"], tags: [] },
  "turn-dial-to-4-on-sheeter-pass-dough-back-through": { stations: ["dough_sheeting"], tags: [] },
  "wet-side-of-dough-facing-up-flour-and-flip": { stations: ["dough_sheeting"], tags: [] },

  // ── Macaroni cheese ────────────────────────────────────────────────────
  "macaroni-cheese-sauce-production": { stations: ["macaroni_cheese"], tags: [] },
  "macaroni-seasoning": { stations: ["macaroni_cheese"], tags: [] },

  // ── Veg / sauce / base prep ────────────────────────────────────────────
  "balsamic-veg-prep": { stations: ["prep_bases"], tags: [] },
  "basil-prep-for-margherita-chicken-chorizo": { stations: ["prep_bases"], tags: [] },
  "cauliflower-cheese-prep": { stations: ["prep_bases"], tags: [] },
  "garlic-butter-prep": { stations: ["prep_bases"], tags: [] },
  "garlic-butter-prosessing": { stations: ["prep_bases"], tags: [] },
  "garlic-cheese-prep": { stations: ["prep_bases"], tags: [] },
  "garlic-confit-prep": { stations: ["prep_bases"], tags: [] },
  "garlic-confit-prep-93": { stations: ["prep_bases"], tags: [] },
  "garlic-confit-prosessing": { stations: ["prep_bases"], tags: [] },
  "nacho-cheese-for-philly-cheese-steak": { stations: ["prep_bases"], tags: [] },
  "prep-garlic-roasted-mushrooms": { stations: ["prep_bases"], tags: [] },
  "pepperoni-mushroom-prep": { stations: ["prep"], tags: [] },
  "red-wine-gravy-pots-for-packing": { stations: ["prep_bases", "packing"], tags: [] },

  // ── Raw meat prep ──────────────────────────────────────────────────────
  "bbq-pulled-pork-prep-raw": { stations: ["prep_meat"], tags: [] },
  "chicken-breading": { stations: ["prep_meat"], tags: [] },
  "chicken-chorizo-prep": { stations: ["prep_meat"], tags: [] },
  "godfather-burger-meat-prep-raw": { stations: ["prep_meat"], tags: [] },
  "how-to-prep-pastrami": { stations: ["prep_meat"], tags: [] },
  "labelling-raw-meat-trays": { stations: ["prep_meat"], tags: ["labels", "safety"] },
  "philly-cheese-steak-prep-raw": { stations: ["prep_meat"], tags: [] },
  "pigs-and-blankets-christmas-bacon": { stations: ["prep_meat"], tags: ["seasonal"] },
  "pigs-and-blankets-christmas-sausage-prep": { stations: ["prep_meat"], tags: ["seasonal"] },
  "piri-piri-chicken-raw": { stations: ["prep_meat"], tags: [] },
  "recieving-raw-meat-delivery-and-putting-away": { stations: ["prep_meat"], tags: ["delivery", "safety"] },
  "sausage-process": { stations: ["prep_meat"], tags: [] },
  "meat-temp-probing": { stations: ["prep_meat", "mixing"], tags: ["safety"] },

  // ── Mixing & cooking ───────────────────────────────────────────────────
  "bbq-pulled-pork-prep-rosemary-bbq-sauce": { stations: ["mixing"], tags: [] },
  "chorizo-chilli-prep": { stations: ["mixing"], tags: [] },
  "godfather-prep": { stations: ["mixing"], tags: [] },
  "meat-cooking-and-ingredient-mixing": { stations: ["mixing"], tags: [] },
  "mixing-bbq-pulled-pork": { stations: ["mixing"], tags: [] },
  "mixing-cooking-step-by-step": { stations: ["mixing"], tags: ["training"] },
  "mixing-meat-cooking": { stations: ["mixing"], tags: [] },

  // ── Building tables ────────────────────────────────────────────────────
  "building-calzones": { stations: [...BUILDING], tags: [] },
  "cleaning-down-production-builders": { stations: [...BUILDING], tags: ["cleaning"] },
  "folding-calzone-with-holes": { stations: [...BUILDING], tags: [] },
  "folding-calzones-with-holes": { stations: [...BUILDING], tags: [] },
  "garlic-butter-application-to-garlic-cheese-calzone": { stations: [...BUILDING], tags: [] },
  "normal-base": { stations: [...BUILDING], tags: [] },
  "spicy-base": { stations: [...BUILDING], tags: [] },
  "setting-up-building-table-for-production": { stations: [...BUILDING], tags: ["equipment"] },

  // ── Ovens & fryer ──────────────────────────────────────────────────────
  "bagging-fried-chicken": { stations: ["ovens", "packing"], tags: [] },
  "defosring-the-blast-chiller-at-the-end-of-the-day": { stations: ["ovens"], tags: ["cleaning", "equipment"] },
  "disposing-fat-bowls-correctly": { stations: ["ovens"], tags: ["cleaning", "safety"] },
  "fryer-set-up": { stations: ["ovens"], tags: ["equipment"] },
  "fryer-setup": { stations: ["ovens"], tags: ["equipment"] },
  "oven-tray-placement": { stations: ["ovens"], tags: [] },
  "ovens": { stations: ["ovens"], tags: ["equipment"] },
  "update-oven-timer": { stations: ["ovens"], tags: ["equipment"] },

  // ── Wrapping ───────────────────────────────────────────────────────────
  "wrapping-calzones": { stations: ["wrapping"], tags: [] },
  "wrapping-calzones-process": { stations: ["wrapping"], tags: [] },

  // ── Packing ────────────────────────────────────────────────────────────
  "best-butcher-order-packing": { stations: ["packing"], tags: ["delivery"] },
  "decanting-pallets-of-small-insulation": { stations: ["packing"], tags: ["delivery"] },
  "insulation-of-box-lining": { stations: ["packing"], tags: [] },
  "left-over-calzone-back-labels": { stations: ["packing"], tags: ["labels"] },
  "packaging-calzone-8-packs": { stations: ["packing"], tags: [] },
  "packing-crates-with-fried-chicken-bags": { stations: ["packing"], tags: [] },
  "packing-large-box": { stations: ["packing"], tags: [] },
  "packing-small-box": { stations: ["packing"], tags: [] },
  "printing-shipping-labels": { stations: ["packing"], tags: ["labels", "delivery"] },
  "printing-shipping-labels-master": { stations: ["packing"], tags: ["labels", "delivery"] },
  "product-front-label-stock-check": { stations: ["packing"], tags: ["labels", "stock-check"] },
  "rear-label-rolls-bread-crumbs": { stations: ["packing"], tags: ["labels"] },
  "replenishing-ice-boxes": { stations: ["packing"], tags: [] },
  "test-box-packing": { stations: ["packing"], tags: [] },

  // ── Admin / office / training (no station) ────────────────────────────
  "adding-wonky-stock-to-shopify": { stations: [], tags: ["shopify", "stock-check"] },
  "bringing-in-delivery": { stations: [], tags: ["delivery"] },
  "change-katasymbol-label-roll": { stations: [], tags: ["labels", "equipment"] },
  "colleague-rota-scheduling": { stations: [], tags: ["office"] },
  "creating-wholesale-orders": { stations: [], tags: ["office", "shopify"] },
  "doing-the-count": { stations: [], tags: ["stock-check"] },
  "exporting-shopify-orders": { stations: [], tags: ["shopify", "office"] },
  "how-to-add-a-product-to-the-menu-in-loop-shopify": { stations: [], tags: ["shopify"] },
  "how-to-clean-the-grease-trap-kit": { stations: [], tags: ["cleaning", "safety", "equipment"] },
  "how-to-create-a-kanban": { stations: [], tags: ["kanban", "training"] },
  "how-to-create-an-invoice-from-a-shopify-order": { stations: [], tags: ["shopify", "office"] },
  "how-to-pull-a-kanban-correctly": { stations: [], tags: ["kanban", "training"] },
  "how-to-set-inkbird-alarms": { stations: [], tags: ["equipment", "safety"] },
  "how-to-train-someone-on-a-process": { stations: [], tags: ["training"] },
  "knife-rack": { stations: [], tags: ["equipment", "safety"] },
  "leave-it-better-than-you-found-it": { stations: [], tags: ["culture", "training"] },
  "next-day-delivery-order-check": { stations: [], tags: ["delivery", "stock-check"] },
  "printing-weekly-cleaning-sheets": { stations: [], tags: ["cleaning", "office"] },
  "process-orders-in-excel": { stations: [], tags: ["office", "shopify"] },
  "receiving-food-deliveries": { stations: [], tags: ["delivery"] },
  "resetting-the-fire-alram": { stations: [], tags: ["safety"] },
  "restocking-kanban-products": { stations: [], tags: ["kanban", "stock-check"] },
  "robo-coupe-blades": { stations: [], tags: ["equipment", "safety"] },
  "run-brownie-report": { stations: [], tags: ["office"] },
  "scale-calibration": { stations: [], tags: ["equipment", "safety"] },
  "setting-up-connected-inventory": { stations: [], tags: ["kanban", "stock-check"] },
  "setup-easyscan-app-in-shopify": { stations: [], tags: ["shopify", "equipment"] },
  "stock-counting-fior-di-latte-weekly": { stations: [], tags: ["stock-check"] },
  "stock-counting-mozzarella-everyday": { stations: [], tags: ["stock-check"] },
  "streamdeck-yellow-triangle-issue": { stations: [], tags: ["equipment"] },
  "sub-recipe-portion-calculation": { stations: [], tags: ["office", "training"] },
  "tck-delivery-temp-record-sheets": { stations: [], tags: ["delivery", "safety"] },
  "thinking-of-the-next-person": { stations: [], tags: ["culture", "training"] },
  "troubleshooting-dpd-upload-issues": { stations: [], tags: ["delivery", "shopify"] },
  "update-shipping-policy-on-website-shopify": { stations: [], tags: ["shopify"] },
  "upload-excess-clearance-stock-for-sale": { stations: [], tags: ["shopify", "stock-check"] },
  "uploading-consignents-to-dpd-from-excel": { stations: [], tags: ["delivery", "office"] },
  "uploading-fried-chicken-stock-to-shopify": { stations: [], tags: ["shopify", "stock-check"] },
  "using-the-sage-coffee-machine": { stations: [], tags: ["equipment"] },
  "value-vs-non-value-activity": { stations: [], tags: ["culture", "training"] },
  "washing-aprons-inner-thermal-gloves-oven-gloves": { stations: [], tags: ["cleaning"] },
  "washing-cloths-and-tea-towels": { stations: [], tags: ["cleaning"] },
  "what-is-3s": { stations: [], tags: ["culture", "training"] },
  "what-is-an-improvement": { stations: [], tags: ["culture", "training"] },
  "what-is-lean": { stations: [], tags: ["culture", "training"] },
};

function arrayLiteral(values: string[]): string {
  if (values.length === 0) return "{}";
  const quoted = values.map(v => {
    if (/^[A-Za-z0-9_:.-]+$/.test(v)) return v;
    const esc = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${esc}"`;
  });
  return `{${quoted.join(",")}}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Pull all imported SOPs along with their existing tag set so we can
  // preserve the internal bookkeeping tags (ref:*, imported:*).
  const sops = await client.query<{ id: number; title: string; tags: string[] }>(
    `SELECT id, title, tags FROM standards_sops WHERE 'imported:gembadocs' = ANY(tags)`,
  );

  let updated = 0;
  let unmapped: string[] = [];
  let totalTags = 0;
  let totalStations = 0;

  try {
    for (const row of sops.rows) {
      const refTag = (row.tags ?? []).find(t => t.startsWith("ref:"));
      if (!refTag) {
        console.warn(`  SKIP — #${row.id} ${row.title}: no ref: tag`);
        continue;
      }
      const slug = refTag.slice("ref:".length);
      const mapping = MAPPINGS[slug];
      if (!mapping) {
        unmapped.push(slug);
        continue;
      }

      // Preserve internal tags, replace the semantic ones.
      const internal = (row.tags ?? []).filter(t => t.startsWith("ref:") || t.startsWith("imported:"));
      const nextTags = [...internal, ...mapping.tags];

      await client.query(
        `UPDATE standards_sops SET stations = $1::text[], tags = $2::text[], updated_at = NOW() WHERE id = $3`,
        [arrayLiteral(mapping.stations), arrayLiteral(nextTags), row.id],
      );
      updated++;
      totalTags += mapping.tags.length;
      totalStations += mapping.stations.length;
    }
  } finally {
    await client.end();
  }

  console.log(`Updated ${updated} SOP(s). ${totalStations} station assignments, ${totalTags} semantic tags.`);
  if (unmapped.length > 0) {
    console.warn(`\n${unmapped.length} SOP(s) not in MAPPINGS table:`);
    for (const s of unmapped) console.warn(`  - ${s}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
