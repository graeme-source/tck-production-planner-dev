/**
 * Cost per kilogram — one figure on every ingredient, sub-recipe and recipe
 * table, so "is this expensive?" and "did the price cut show?" read the same
 * everywhere (Graeme, 28 Oct 2026: "I want a cost per kilo on all of them").
 *
 * Volumes count at density 1 (1 L = 1 kg), as the rest of this module does.
 * Count units ("each", "box") have no honest per-kg figure: null, and the
 * screen says so rather than guessing.
 */
import { kgOrNull } from "./index";

/** £ per kg for `cost` buying `qty` `unit`; null when it can't be worked out. */
export function costPerKg(cost: number | string | null | undefined, qty: number | string | null | undefined, unit: string | null | undefined): number | null {
  const c = Number(cost);
  const kg = kgOrNull(Number(qty), unit);
  if (!Number.isFinite(c) || c <= 0 || kg == null || !(kg > 0)) return null;
  return c / kg;
}

/** "£12.34/kg" — pence shown for anything under 10p a kg. */
export function formatCostPerKg(perKg: number | null | undefined): string {
  if (perKg == null || !Number.isFinite(perKg)) return "—";
  return `£${perKg.toFixed(perKg >= 0.1 ? 2 : 4)}/kg`;
}
