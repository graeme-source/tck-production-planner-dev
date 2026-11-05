/**
 * The band across the top of a Numbers panel (Graeme, 5 Nov 2026): its grade
 * in the Advertising Efficiency colours, the three benchmarks scaled to the
 * period, and an arrow for whether it's improving. Maths and rules:
 * lib/numbers-benchmarks.ts. A KPI with no benchmarks shows just the arrow.
 */
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBenchmark, gradeKpi, kpiChange, kpiSpec, type KpiChange, type KpiId } from "@/lib/numbers-benchmarks";
import { useNumbersBenchmarks } from "./api";

const CHANGE_CLASS = (c: KpiChange) =>
  c.better == null ? "text-stone-700" : c.better ? "text-emerald-700" : "text-rose-700";

export function KpiGradeStrip({ kpi, value, days = 1, prior, compareLabel }: {
  kpi: KpiId;
  value: number | null | undefined;
  /** Days the benchmark covers: benchmarkDays(). */
  days?: number;
  /** The same figure in the period it's compared with. */
  prior?: number | null;
  compareLabel: string;
}) {
  const { data } = useNumbersBenchmarks();
  const spec = kpiSpec(kpi);
  const grade = gradeKpi(value, data?.benchmarks[kpi], spec, days);
  const change = kpiChange(value, prior, spec);
  if (!grade && !change) return null;
  const Arrow = change?.direction === "up" ? ArrowUpRight : change?.direction === "down" ? ArrowDownRight : Minus;
  return (
    <div
      className={cn("px-5 py-2", grade ? (grade.shade.darkBackground ? "text-white" : "text-stone-900") : "bg-secondary/60")}
      style={grade ? { backgroundColor: grade.shade.hex } : undefined}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-bold">{grade?.word}</span>
        {change && (
          <span className={cn("inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-bold tabular-nums", CHANGE_CLASS(change))}>
            <Arrow className="w-3.5 h-3.5" />
            {change.direction === "flat" ? "Level" : `${change.percent}%`} vs {compareLabel}
          </span>
        )}
      </div>
      {grade && (
        <p className="text-[11px] font-medium opacity-90 tabular-nums mt-0.5">
          Min {formatBenchmark(grade.levels.minimum, spec.unit)} · Good {formatBenchmark(grade.levels.good, spec.unit)} · Very good {formatBenchmark(grade.levels.veryGood, spec.unit)}
        </p>
      )}
    </div>
  );
}
