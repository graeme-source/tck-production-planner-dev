/**
 * The record kept for every back-label print run (traceability, Objective D):
 * who printed what, which LIVE label version, how many, and the dates and
 * batch on them. Built here (pure, tested); stored in product_label_prints.
 */
import type { LabelDates } from "./dates";

export type PrintFormat = "pdf" | "tspl" | "zpl";

export interface PrintRecord {
  recipeId: number;
  recipeName: string;
  labelVersionId: number;
  versionNo: number;
  snapshotHash: string;
  count: number;
  printDate: string;
  productionDate: string;
  batchCode: string;
  chilledUseBy: string | null;
  frozenUseBy: string | null;
  planId: number | null;
  planItemId: number | null;
  format: PrintFormat;
  printedById: number | null;
  printedByName: string | null;
}

export function buildPrintRecord(input: {
  recipe: { id: number; name: string };
  live: { id: number; versionNo: number; snapshotHash: string };
  count: number;
  dates: LabelDates;
  plan: { planId: number | null; planItemId: number | null };
  format: PrintFormat;
  user: { id: number | null; name: string | null };
}): PrintRecord {
  if (!Number.isInteger(input.count) || input.count < 1) throw new Error("At least one label");
  return {
    recipeId: input.recipe.id,
    recipeName: input.recipe.name,
    labelVersionId: input.live.id,
    versionNo: input.live.versionNo,
    snapshotHash: input.live.snapshotHash,
    count: input.count,
    printDate: input.dates.printDate,
    productionDate: input.dates.productionDate,
    batchCode: input.dates.batchCode,
    chilledUseBy: input.dates.chilledUseBy,
    frozenUseBy: input.dates.frozenUseBy,
    planId: input.plan.planId,
    planItemId: input.plan.planItemId,
    format: input.format,
    printedById: input.user.id,
    printedByName: input.user.name,
  };
}
