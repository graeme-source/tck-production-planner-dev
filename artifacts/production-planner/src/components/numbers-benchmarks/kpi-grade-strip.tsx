/**
 * The colour band across the top of a Numbers panel (Graeme, 5 Nov 2026): the
 * Advertising Efficiency scale, for where the figure sits against its minimum
 * and stretch, with those two figures scaled to the period. On a running day
 * it says where the day is heading. The founder sets the figures from here;
 * the monthly revenue panels' pencil opens the monthly targets.
 * Rules: lib/numbers-benchmarks.ts.
 */
import { useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBenchmark, gradeKpi, kpiSpec, type KpiId } from "@/lib/numbers-benchmarks";
import { useThisMonthTargets } from "@/components/revenue-targets/api";
import { useTargetsEditor } from "@/components/revenue-targets/edit-targets-dialog";
import { useNumbersBenchmarks } from "./api";
import { BenchmarksDialog } from "./benchmarks-dialog";

export function KpiGradeStrip({ kpi, value, days = 1, forecast }: {
  kpi: KpiId;
  value: number | null | undefined;
  /** Days the benchmark covers: benchmarkDays(). Null = too early to judge. */
  days?: number | null;
  /** Where a running day should end up: dayForecast(). */
  forecast?: number | null;
}) {
  const { data } = useNumbersBenchmarks();
  const [editing, setEditing] = useState(false);
  const spec = kpiSpec(kpi);
  const { thisMonth } = useThisMonthTargets();
  const monthlyEditor = useTargetsEditor();
  const benchmark = spec.monthlyTarget
    ? (thisMonth ? { minimum: thisMonth.minimum, stretch: thisMonth.stretch } : undefined)
    : data?.benchmarks[kpi];
  const edit = () => { if (spec.monthlyTarget) monthlyEditor.open(); else setEditing(true); };
  const grade = days == null ? null : gradeKpi(value, benchmark, spec, days);
  const hasBenchmark = benchmark?.minimum != null && benchmark.stretch != null;
  if (!hasBenchmark && !data?.canEdit) return null;

  const words = grade
    ? `Min ${formatBenchmark(grade.levels.minimum, spec.unit)} · Stretch ${formatBenchmark(grade.levels.stretch, spec.unit)}`
    : hasBenchmark ? (days == null ? "Too early to tell" : "No figure yet") : "Set a target";
  return (
    <>
      <div
        className={cn("px-5 py-1.5 flex items-center justify-between gap-2 flex-wrap text-xs font-semibold tabular-nums", grade ? (grade.shade.darkBackground ? "text-white" : "text-stone-900") : "bg-secondary/60 text-muted-foreground")}
        style={grade ? { backgroundColor: grade.shade.hex } : undefined}
      >
        <span>{words}</span>
        <span className="inline-flex items-center gap-2">
          {forecast != null && <span>On course for {formatBenchmark(forecast, spec.unit)}</span>}
          {data?.canEdit && (
            // A span, not a button: the band can sit inside a tile that is one.
            <span
              role="button"
              tabIndex={0}
              aria-label={`Change the ${spec.label} target`}
              onClick={(e) => { e.stopPropagation(); edit(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); edit(); } }}
              className="p-1 rounded hover:bg-black/10 cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
            </span>
          )}
        </span>
      </div>
      {editing && <BenchmarksDialog only={kpi} onClose={() => setEditing(false)} />}
      {monthlyEditor.element}
    </>
  );
}
