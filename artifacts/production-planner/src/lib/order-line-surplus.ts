/**
 * Orders page line maths, client side (Objective C).
 *
 * `suggestedPacks` is the page's copy of the server suggestion
 * (routes/orders.ts /calculate: required + surplus + outstanding prep −
 * stock − inbound, whole packs, kanban floor, whole cases) — moved here out
 * of the stock-edit handler so the delivery-date change uses the same one.
 *
 * `withDeliverySurplus` re-asks surplusFor (@workspace/business-days — the
 * same rule the server used) when the person moves a supplier's delivery
 * date: an ingredient with surplus by delivery day then carries the new
 * day's surplus (Graeme, 14 Oct 2026). Lines without the setting, or
 * without the inputs (kanban-only / manual / misc lines), come back as-is.
 */
import { surplusFor, surplusLabel, toISODate, type SurplusByDeliveryWeekday } from "@workspace/business-days";

export type SurplusLineFields = {
  totalRequired: number;
  surplusTarget: number;
  prepOutstandingQty?: number;
  inboundQty?: number;
  packWeight: number;
  isKanban: boolean;
  kanbanFloorPacks?: number | null;
  caseSizePacks?: number | null;
  surplusPercentApplied?: number | null;
  surplusFromDeliveryDay?: boolean;
  surplusDeliveryDate?: string | null;
  surplusExplanation?: string;
  surplusDailyRequirement?: number;
  surplusMode?: "percent" | "absolute";
  surplusBasePercent?: number;
  surplusAbsoluteQty?: number | null;
  surplusByDeliveryWeekday?: SurplusByDeliveryWeekday | null;
};

export function suggestedPacks(line: SurplusLineFields, stock: number): number {
  const rawOrderQty = Math.max(0, line.totalRequired + line.surplusTarget + (line.prepOutstandingQty ?? 0) - Math.max(0, stock) - (line.inboundQty ?? 0));
  let packs = line.packWeight > 0 ? Math.ceil(rawOrderQty / line.packWeight) : 0;
  if (line.isKanban && (line.kanbanFloorPacks ?? 0) > 0) packs = Math.max(packs, line.kanbanFloorPacks ?? 0);
  const caseSizePacks = line.caseSizePacks ?? 0;
  if (caseSizePacks > 0 && packs > 0) packs = Math.ceil(packs / caseSizePacks) * caseSizePacks;
  return packs;
}

/** True when moving the delivery date can change this line's surplus. */
export function surplusDependsOnDeliveryDay(line: SurplusLineFields): boolean {
  return line.surplusMode === "percent"
    && line.surplusDailyRequirement != null
    && line.surplusByDeliveryWeekday != null
    && Object.keys(line.surplusByDeliveryWeekday).length > 0;
}

/** The line with its surplus re-worked for this delivery date (unchanged
 *  object when the date can't matter). */
export function withDeliverySurplus<T extends SurplusLineFields>(line: T, deliveryDate: Date): T {
  if (!surplusDependsOnDeliveryDay(line)) return line;
  const r = surplusFor(
    {
      surplusMode: line.surplusMode,
      surplusPercent: line.surplusBasePercent,
      surplusAbsoluteQty: line.surplusAbsoluteQty,
      surplusByDeliveryWeekday: line.surplusByDeliveryWeekday,
    },
    deliveryDate,
    line.surplusDailyRequirement ?? 0,
  );
  return {
    ...line,
    surplusTarget: Math.round(r.qty * 100) / 100,
    surplusPercentApplied: r.percent,
    surplusFromDeliveryDay: r.fromDeliveryDay,
    surplusDeliveryDate: toISODate(deliveryDate),
    surplusExplanation: surplusLabel(r),
  };
}
