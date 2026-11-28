/**
 * The TCK run rate report for a date range — GET /api/reports/production-kpis
 * (team, per builder and per day, all through lib/run-rate.ts on the server).
 * Read by Analytics → KPIs; types moved out of pages/reports.tsx on
 * 17 Nov 2026. Objective G.
 */
import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type KpiStatus = "above" | "on-target" | "below" | "unknown";

export interface KpiOverview {
  totalBatches: number;
  totalActiveMinutes: number;
  overallBph: number | null;
  uniqueDays: number;
  avgBatchesPerDay: number;
  productionStartTime: string | null;
  productionFinishTime: string | null;
  wallClockMinutes: number;
  targetBph: number | null;
  minBph: number | null;
  /** The range's run rate without the improvement credit. */
  overallBphBeforeCredit: number | null;
  improvementMinutesCredited: number;
}

/** Improvement time credited to a KPI (api lib/improvement-kpi-credit.ts). */
export interface ImprovementCredit {
  improvements: number;
  /** Minutes credited (people × minutes per improvement). */
  minutes: number;
  /** Minutes that counted after the half-the-day cap. */
  minutesApplied: number;
  people: Array<{ userId: number; name: string | null; improvements: number; minutes: number }>;
  /** Run rate only: people on production that day — the time was shared across them. */
  headcount?: number;
}

export interface RangeImprovementCredit extends ImprovementCredit {
  minutesPerImprovement: number | null;
  unavailable: string | null;
  notCounted: Array<{ userId: number; name: string | null; improvements: number; minutes: number; reason: "no-shift" | "not-linked" | "other-shift" | "planday-unavailable" }>;
  /** People whose improvements counted on the room score instead. */
  roomPeople: ImprovementCredit["people"];
}

export interface KpiBuilder {
  userId: number;
  userName: string;
  totalBatches: number;
  totalActiveMinutes: number;
  daysWorked: number;
  bph: number | null;
  status: KpiStatus;
}

export interface KpiDayBuilder {
  userId: number;
  userName: string;
  batches: number;
  activeMinutes: number;
  breakMinutesDeducted: number;
  bph: number | null;
  status: KpiStatus;
}

export interface KpiDay {
  date: string;
  planId: number;
  planName: string;
  batches: number;
  windowStart: string | null;
  windowEnd: string | null;
  finishSource: "marked" | "last-batch";
  wallClockMinutes: number;
  morningBreakDeducted: boolean;
  lunchBreakDeducted: boolean;
  breakMinutesDeducted: number;
  activeMinutes: number;
  bph: number | null;
  status: KpiStatus;
  improvementCredit: ImprovementCredit;
  bphBeforeCredit: number | null;
  activeMinutesBeforeCredit: number;
  recipes: Array<{ name: string; count: number }>;
  builders: KpiDayBuilder[];
}

export interface KpiReportData {
  overview: KpiOverview;
  improvementCredit: RangeImprovementCredit;
  breakConfig: {
    morningMinutes: number;
    lunchMinutes: number;
    morningAnchorMinutes: number;
    lunchAnchorMinutes: number;
  };
  builders: KpiBuilder[];
  dailyDetail: KpiDay[];
}

export function useRunRateReport(fromDate: string, toDate: string) {
  return useQuery<KpiReportData>({
    queryKey: ["reports", "production-kpis", fromDate, toDate],
    enabled: !!fromDate && !!toDate,
    queryFn: async () => {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      const r = await fetch(`${BASE}/api/reports/production-kpis?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Couldn't load the run rate");
      return r.json();
    },
    staleTime: 60_000,
    placeholderData: prev => prev,
  });
}
