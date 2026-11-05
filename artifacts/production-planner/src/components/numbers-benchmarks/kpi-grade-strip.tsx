/**
 * The coloured title bar of a Numbers panel (Graeme, 5 Nov 2026), like the
 * Advertising Efficiency cards: the panel's name, in the colour for where its
 * figure sits against its minimum and stretch. On a running day it says where
 * the day is heading. The figures themselves are behind the pencil; sales
 * panels' pencil opens the Targets menu. Rules: lib/numbers-benchmarks.ts.
 */
import { useState } from "react";
import { Pencil } from "lucide-react";
import { daysInMonth } from "@workspace/revenue-targets";
import { cn } from "@/lib/utils";
import { formatBenchmark, gradeKpi, kpiSpec, salesBenchmark, type KpiId } from "@/lib/numbers-benchmarks";
import { useThisMonthTargets } from "@/components/revenue-targets/api";
import { useTargetsEditor } from "@/components/revenue-targets/edit-targets-dialog";
import { useNumbersBenchmarks } from "./api";
import { BenchmarksDialog } from "./benchmarks-dialog";

export interface KpiGradeStripProps {
  kpi: KpiId;
  value: number | null | undefined;
  /** Filled in by the tile from its own title. */
  title?: string;
  qualifier?: string;
  /** Days the benchmark covers: benchmarkDays(). Null = too early to judge. */
  days?: number | null;
  /** Where a running day or month should end up. */
  forecast?: number | null;
}

export function KpiGradeStrip({ kpi, value, title, qualifier, days = 1, forecast }: KpiGradeStripProps) {
  const { data } = useNumbersBenchmarks();
  const [editing, setEditing] = useState(false);
  const spec = kpiSpec(kpi);
  const { thisMonth } = useThisMonthTargets();
  const targets = useTargetsEditor();
  const benchmark = !spec.monthlyTarget ? data?.benchmarks[kpi]
    : !thisMonth ? undefined
      : kpi === "sales" ? salesBenchmark(thisMonth.minimum, thisMonth.stretch, daysInMonth(thisMonth.month))
        : { minimum: thisMonth.minimum, stretch: thisMonth.stretch };
  const grade = days == null ? null : gradeKpi(value, benchmark, spec, days);
  const hasBenchmark = benchmark?.minimum != null && benchmark.stretch != null;
  const canEdit = !!data?.canEdit;
  const edit = () => { if (spec.monthlyTarget) targets.open(); else setEditing(true); };

  const note = forecast != null ? `On course for ${formatBenchmark(forecast, spec.unit)}`
    : grade ? null
      : hasBenchmark ? (days == null ? "Too early to tell" : null)
        : canEdit ? "Set a target" : null;
  return (
    <>
      <div
        className={cn("px-5 py-3", grade ? (grade.shade.darkBackground ? "text-white" : "text-stone-900") : "bg-secondary text-foreground")}
        style={grade ? { backgroundColor: grade.shade.hex } : undefined}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-lg font-display font-bold leading-tight">{title}</p>
          {canEdit && (
            // A span, not a button: the bar can sit inside a tile that is one.
            <span
              role="button"
              tabIndex={0}
              aria-label={`Change the ${spec.label} target`}
              onClick={(e) => { e.stopPropagation(); edit(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); edit(); } }}
              className="p-1 -m-1 rounded hover:bg-black/10 cursor-pointer flex-shrink-0"
            >
              <Pencil className="w-4 h-4" />
            </span>
          )}
        </div>
        {qualifier && <p className="text-xs font-medium opacity-90 mt-0.5">{qualifier}</p>}
        {note && <p className="text-sm font-semibold opacity-90 tabular-nums mt-0.5">{note}</p>}
      </div>
      {editing && <BenchmarksDialog only={kpi} onClose={() => setEditing(false)} />}
      {targets.element}
    </>
  );
}
