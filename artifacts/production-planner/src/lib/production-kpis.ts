/**
 * Production KPIs (Graeme, 13 Nov 2026) — each station's standard ("on
 * target") and stretch ("smashing it"), stored in the production_kpis table
 * and edited on Analytics → Production KPIs. Every screen that colours a
 * pace reads them from here, so the dashboard tile and the packing screen
 * can no longer disagree (packing was 50 on the tile, 55 on the screen).
 *
 * One rule everywhere: stretch and over = top colour, standard and over =
 * green, from 90% of standard = amber, below that = the low colour. Pure.
 */
import { BAND_RATIOS } from "./station-kpi-bands";

export type ProductionKpiKey = "packing" | "wrapping";

export interface ProductionKpi {
  standard: number;
  stretch: number | null;
}

/** What the screens used before the page existed — and the fallback while
 *  the stored figures load. Same as migration 0371's starting figures. */
export const DEFAULT_PRODUCTION_KPIS: Record<ProductionKpiKey, ProductionKpi> = {
  packing: { standard: 55, stretch: 60 },
  wrapping: { standard: 180, stretch: 240 },
};

export interface ProductionKpiInfo {
  key: ProductionKpiKey;
  name: string;
  unit: string;
  /** How the rate is measured, in a sentence. */
  measure: string;
  /** Where the figures show up. */
  usedOn: string;
}

export const PRODUCTION_KPI_INFO: ProductionKpiInfo[] = [
  {
    key: "packing", name: "Packing", unit: "orders an hour",
    measure: "Orders fulfilled ÷ the packing team's active time.",
    usedOn: "The pace tile on Order Packing Live and the Packing tile on the dashboard.",
  },
  {
    key: "wrapping", name: "Wrapping", unit: "packs an hour",
    measure: "Packs wrapped ÷ active wrapping time (gaps over 20 minutes left out).",
    usedOn: "The pace strip on the wrapping station and the Wrapping tile on the dashboard.",
  },
];

/** The stored figures with defaults filled in. */
export function resolveKpis(stored: Partial<Record<string, ProductionKpi>> | undefined): Record<ProductionKpiKey, ProductionKpi> {
  return {
    packing: stored?.packing ?? DEFAULT_PRODUCTION_KPIS.packing,
    wrapping: stored?.wrapping ?? DEFAULT_PRODUCTION_KPIS.wrapping,
  };
}

/** The amber line: 90% of standard, the same ratio as the dashboard. */
export function amberFrom(kpi: ProductionKpi): number {
  return Math.round(kpi.standard * BAND_RATIOS.amber * 10) / 10;
}

export type PaceLevel = "stretch" | "standard" | "close" | "below";

/** Where a live pace sits against a KPI. */
export function paceLevel(rate: number, kpi: ProductionKpi): PaceLevel {
  if (kpi.stretch != null && rate >= kpi.stretch) return "stretch";
  if (rate >= kpi.standard) return "standard";
  if (rate >= amberFrom(kpi)) return "close";
  return "below";
}

/** Problems with a standard + stretch the page is about to save. */
export function kpiProblem(standard: number, stretch: number | null): string | null {
  if (!Number.isFinite(standard) || standard <= 0) return "The standard has to be above 0.";
  if (stretch != null && (!Number.isFinite(stretch) || stretch <= standard)) return "The stretch has to be above the standard.";
  return null;
}
