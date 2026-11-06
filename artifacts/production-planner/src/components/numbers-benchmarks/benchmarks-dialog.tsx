/**
 * The founder's targets for the Numbers panels (Objective I). BenchmarkRows
 * sits inside Edit targets, under the monthly sales targets; the pencil on a
 * panel opens that one panel's row. Each KPI's two figures autosave together
 * with a visible state. Sales aren't here: they're the monthly targets.
 * Closable (X, backdrop, Escape), max-h-[92dvh] with internal scrolling.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Target, X } from "lucide-react";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { benchmarkProblem, KPIS, type Benchmark, type KpiId, type KpiSpec, type KpiUnit } from "@/lib/numbers-benchmarks";
import { useNumbersBenchmarks, useSaveBenchmark } from "./api";

/** Every panel's targets, sales aside: the Numbers ones, or the Ads page's. */
export function BenchmarkRows({ only, ads = false }: { only?: KpiId; ads?: boolean }) {
  const { data } = useNumbersBenchmarks();
  if (!data) return null;
  return (
    <>
      {KPIS.filter((spec: KpiSpec) => !spec.monthlyTarget && !!spec.ads === ads && (!only || spec.id === only)).map((spec) => (
        <BenchmarkRow key={spec.id} spec={spec} value={data.benchmarks[spec.id]} />
      ))}
    </>
  );
}

export function BenchmarksDialog({ only, ads = false, onClose }: { only?: KpiId; ads?: boolean; onClose: () => void }) {
  const { data } = useNumbersBenchmarks();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!data) return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] bg-black/70 flex items-center justify-center p-3 md:p-8" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="benchmarks-title"
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden text-left text-foreground font-normal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Target className="w-6 h-6 text-primary flex-shrink-0" />
          <h2 id="benchmarks-title" className="flex-1 min-w-0 font-display font-bold text-xl leading-tight">{ads ? "Ads targets" : "Target"}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <BenchmarkRows only={only} ads={ads} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

const UNIT_LABEL: Record<KpiUnit, string> = {
  "£": "£", "£p": "£", "%": "%", "%2": "% · spend ÷ reach", count: "", ratio: "£ back for each £1 spent",
};

const unitLabel = (spec: KpiSpec) => [UNIT_LABEL[spec.unit], spec.perDay ? "per day" : ""].filter(Boolean).join(" ");

const asText = (n: number | null | undefined) => (n == null ? "" : String(n));

function BenchmarkRow({ spec, value }: { spec: KpiSpec; value: Benchmark | undefined }) {
  const save = useSaveBenchmark();
  const [draft, setDraft] = useState<Benchmark>(value ?? { minimum: null, stretch: null });
  // What's typed is kept as text, so "2." can become "2.5".
  const [text, setText] = useState({ minimum: asText(value?.minimum), stretch: asText(value?.stretch) });
  const auto = useAutosave((benchmark: Benchmark) => save.mutateAsync({ kpi: spec.id as KpiId, benchmark }));
  const set = (key: keyof Benchmark, typed: string) => {
    const n = typed.trim() === "" ? null : Number(typed);
    if (n != null && (!Number.isFinite(n) || n < 0)) return;
    setText({ ...text, [key]: typed });
    const next = { ...draft, [key]: n };
    setDraft(next);
    auto.schedule(next);
  };
  const problem = benchmarkProblem(draft, spec);
  const fields: Array<{ key: keyof Benchmark; label: string }> = [
    { key: "minimum", label: spec.lowerIsBetter ? "Limit" : "Minimum" },
    { key: "stretch", label: "Stretch" },
  ];
  return (
    <section className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="font-semibold">
          {spec.label}
          {unitLabel(spec) && <span className="text-xs text-muted-foreground font-normal"> · {unitLabel(spec)}</span>}
          {spec.lowerIsBetter && <span className="text-xs text-muted-foreground font-normal"> · less is better</span>}
        </p>
        <SaveChip state={auto.state} error={auto.error} onRetry={auto.flush} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fields.map(({ key, label }) => (
          <label key={key} className="text-xs font-medium text-muted-foreground">
            {label}
            <input
              inputMode="decimal"
              value={text[key]}
              onChange={(e) => set(key, e.target.value)}
              onBlur={auto.flush}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-base font-semibold text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>
        ))}
      </div>
      {problem && <p className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
    </section>
  );
}
