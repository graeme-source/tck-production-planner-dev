/**
 * The text the assistant's get_todays_production_plan tool returns (moved
 * out of tools.ts, 2026-10-05). Calzone and mac cheese totals use the shared
 * main-kitchen rule; fried chicken (made in a separate facility, counted in
 * bags) gets its own line instead of being added to the calzone batches.
 * Pure.
 */
import { kitchenLine } from "@workspace/production-schedule";

export interface PlanSummaryItem {
  batchesTarget: number;
  batchesComplete: number;
  recipeName: string | null;
  recipeCategory: string | null;
  packSize: string | number | null;
}

export function planSummaryText(today: string, plan: { status: string; name: string }, items: readonly PlanSummaryItem[]): string {
  const line = (i: PlanSummaryItem) => kitchenLine(i.recipeCategory);
  const calzones = items.filter(i => line(i) === "calzone");
  const macCheese = items.filter(i => line(i) === "mac");
  const separate = items.filter(i => line(i) === "separate");

  const calzoneBatches = calzones.reduce((sum, i) => sum + i.batchesTarget, 0);
  const calzoneComplete = calzones.reduce((sum, i) => sum + i.batchesComplete, 0);
  // Mac cheese is tracked in packs rather than batches: packSize × batchesTarget.
  const macCheesePacks = macCheese.reduce((sum, i) => sum + i.batchesTarget * Number(i.packSize ?? 1), 0);
  const macCheesePacksComplete = macCheese.reduce((sum, i) => sum + i.batchesComplete * Number(i.packSize ?? 1), 0);
  // Separate-facility items: one batch row is one bag.
  const separateBags = separate.reduce((sum, i) => sum + i.batchesTarget, 0);

  const topProducts = [...items]
    .sort((a, b) => b.batchesTarget - a.batchesTarget)
    .slice(0, 8)
    .map(i => {
      const k = line(i);
      const unit = k === "mac" ? "packs" : k === "separate" ? "bags" : "batches";
      const qty = k === "mac" ? i.batchesTarget * Number(i.packSize ?? 1) : i.batchesTarget;
      const done = k === "mac" ? i.batchesComplete * Number(i.packSize ?? 1) : i.batchesComplete;
      return `  - ${i.recipeName ?? "Unknown"}: ${qty} ${unit}${done > 0 ? ` (${done} complete)` : ""}`;
    })
    .join("\n");

  const lines = [
    `Production plan for ${today} (status: ${plan.status}, name: ${plan.name}):`,
  ];
  if (calzones.length > 0) {
    lines.push(`- Calzones: ${calzoneBatches} batches across ${calzones.length} product${calzones.length === 1 ? "" : "s"}${calzoneComplete > 0 ? ` — ${calzoneComplete} batches complete so far` : ""}.`);
  }
  if (macCheese.length > 0) {
    lines.push(`- Macaroni Cheese: ${macCheesePacks} packs across ${macCheese.length} product${macCheese.length === 1 ? "" : "s"}${macCheesePacksComplete > 0 ? ` — ${macCheesePacksComplete} packs complete so far` : ""}.`);
  }
  if (separate.length > 0) {
    const cats = [...new Set(separate.map(i => i.recipeCategory ?? "Other"))].join(", ");
    lines.push(`- ${cats} (made in a separate facility, not part of the kitchen's batches): ${separateBags} bags across ${separate.length} product${separate.length === 1 ? "" : "s"}.`);
  }
  lines.push(`Products:\n${topProducts}`);
  return lines.join("\n");
}
