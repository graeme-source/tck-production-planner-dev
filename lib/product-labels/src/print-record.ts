/**
 * The record kept for every back-label print run (traceability, Objective D):
 * who printed what, which LIVE label version, how many, and the dates and
 * batch on them. Built here (pure, tested); stored in product_label_prints.
 */
import type { LabelDates } from "./dates";

export type PrintFormat = "pdf" | "tspl" | "zpl";
/** production = wrapping station (labels for real packs); test = a test
 *  print from the label review page, never counted as labels on product. */
export type PrintKind = "production" | "test";

export interface PrintRecord {
  recipeId: number;
  recipeName: string;
  /** Null for a test print of the current, never-published proof. */
  labelVersionId: number | null;
  versionNo: number | null;
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
  kind: PrintKind;
  printedById: number | null;
  printedByName: string | null;
}

export function buildPrintRecord(input: {
  recipe: { id: number; name: string };
  /** The live version printed — or, for a test print of the current proof,
   *  just its snapshot hash (id / versionNo null). */
  live: { id: number | null; versionNo: number | null; snapshotHash: string };
  count: number;
  dates: LabelDates;
  plan: { planId: number | null; planItemId: number | null };
  format: PrintFormat;
  kind?: PrintKind;
  user: { id: number | null; name: string | null };
}): PrintRecord {
  if (!Number.isInteger(input.count) || input.count < 1) throw new Error("At least one label");
  const kind = input.kind ?? "production";
  // Production labels go on real packs: only ever from a live version.
  if (kind === "production" && (input.live.id == null || input.live.versionNo == null)) {
    throw new Error("Production labels must come from the live label");
  }
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
    kind,
    printedById: input.user.id,
    printedByName: input.user.name,
  };
}
