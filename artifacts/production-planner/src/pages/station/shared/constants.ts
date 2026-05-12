import { Construction, Waves, Flame, Gift, Box, Salad, Layers, UtensilsCrossed } from "lucide-react";
import type { ProductionPlanItem } from "@workspace/api-client-react";

export const MAC_CHEESE_CATEGORY = "Macaroni Cheese";

export function isMacCheese(item: { recipeCategory?: string | null }): boolean {
  return item.recipeCategory === MAC_CHEESE_CATEGORY;
}

/** Stable comparator for plan items across every station and the plans
 *  list. Mac & Cheese variants always sort ahead of calzones — kitchen
 *  convention, since Mac & Cheese starts the day on its own line. Within
 *  each category, items keep their saved orderPosition so the operator's
 *  drag-reorder still works. */
export function compareItemsForDisplay(
  a: { orderPosition: number; recipeCategory?: string | null },
  b: { orderPosition: number; recipeCategory?: string | null },
): number {
  const aRank = isMacCheese(a) ? 0 : 1;
  const bRank = isMacCheese(b) ? 0 : 1;
  return aRank - bRank || a.orderPosition - b.orderPosition;
}

export const STATIONS = [
  { key: "dough_prep", label: "Dough Prep", short: "Dough Prep", icon: Layers, color: "text-amber-600" },
  { key: "macaroni_cheese", label: "Macaroni Cheese", short: "Mac Cheese", icon: UtensilsCrossed, color: "text-yellow-600" },
  { key: "dough_sheeting", label: "Dough Sheeting", short: "Sheeting", icon: Layers, color: "text-amber-500" },
  { key: "prep", label: "Prep", short: "Prep", icon: Salad, color: "text-green-500" },
  { key: "mixing", label: "Mixing & Cooking", short: "Mixing", icon: Waves, color: "text-blue-500" },
  { key: "building_1", label: "Building Table 1", short: "Build 1", icon: Construction, color: "text-orange-500" },
  { key: "building_2", label: "Building Table 2", short: "Build 2", icon: Construction, color: "text-orange-400" },
  { key: "ovens", label: "Ovens", short: "Ovens", icon: Flame, color: "text-red-500" },
  { key: "wrapping", label: "Wrapping", short: "Wrapping", icon: Gift, color: "text-purple-500" },
  { key: "packing", label: "Packing", short: "Packing", icon: Box, color: "text-indigo-500" },
] as const;

export type StationType = typeof STATIONS[number]["key"] | "main_prep" | "prep_bases" | "prep_meat";

export function getStationCount(item: ProductionPlanItem, stationType: string): number {
  const sc = (item as any).stationCompletions;
  if (!sc || typeof sc !== "object") return 0;
  return sc[stationType] ?? 0;
}

export function getPrevStationCount(item: ProductionPlanItem, stationType: string): number {
  const sc = (item as any).stationCompletions;
  if (!sc || typeof sc !== "object") return item.batchesTarget ?? 0;
  const itemIsMacCheese = isMacCheese(item as any);
  const deps: Record<string, string[]> = {
    building_1: ["mixing"],
    building_2: ["mixing"],
    macaroni_cheese: [],
    ovens: ["building_1", "building_2"],
    wrapping: itemIsMacCheese ? ["macaroni_cheese"] : ["ovens"],
  };
  const prevStations = deps[stationType];
  if (!prevStations || prevStations.length === 0) return item.batchesTarget ?? 0;
  return prevStations.reduce((sum, s) => sum + (sc[s] ?? 0), 0);
}

export function getAvailableFromPrev(item: ProductionPlanItem, stationType: string): number {
  return Math.max(0, getPrevStationCount(item, stationType) - getStationCount(item, stationType));
}
