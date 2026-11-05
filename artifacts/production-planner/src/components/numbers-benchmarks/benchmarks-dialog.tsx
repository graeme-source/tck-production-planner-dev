/**
 * The founder's benchmark editor for the Numbers panels (Objective I). Each
 * KPI's three figures autosave together with a visible state. Closable (X,
 * backdrop, Escape), max-h-[92dvh] with internal scrolling.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Gauge, X } from "lucide-react";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { benchmarkProblem, KPIS, type Benchmark, type KpiId, type KpiSpec } from "@/lib/numbers-benchmarks";
import { useNumbersBenchmarks, useSaveBenchmark } from "./api";

const FIELDS: Array<{ key: keyof Benchmark; label: string }> = [
  { key: "minimum", label: "Minimum" },
  { key: "good", label: "Good" },
  { key: "veryGood", label: "Very good" },
];

export function BenchmarksButton() {
  const { data } = useNumbersBenchmarks();
  const [open, setOpen] = useState(false);
  if (!data?.canEdit) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border-2 border-border bg-card hover:bg-secondary/60"
      >
        <Gauge className="w-4 h-4 text-primary" /> Benchmarks
      </button>
      {open && <BenchmarksDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function BenchmarksDialog({ onClose }: { onClose: () => void }) {
  const { data } = useNumbersBenchmarks();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!data) return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] bg-black/70 flex items-center justify-center p-3 md:p-8" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="benchmarks-title"
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Gauge className="w-6 h-6 text-primary flex-shrink-0" />
          <h2 id="benchmarks-title" className="flex-1 min-w-0 font-display font-bold text-xl leading-tight">Benchmarks</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {KPIS.map((spec) => (
            <BenchmarkRow key={spec.id} spec={spec} value={data.benchmarks[spec.id]} />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const unitLabel = (spec: KpiSpec) => {
  const unit = spec.unit === "count" ? "" : spec.unit;
  return [unit, spec.perDay ? "per day" : ""].filter(Boolean).join(" ");
};

function BenchmarkRow({ spec, value }: { spec: KpiSpec; value: Benchmark | undefined }) {
  const save = useSaveBenchmark();
  const [draft, setDraft] = useState<Benchmark>(value ?? { minimum: null, good: null, veryGood: null });
  const auto = useAutosave((benchmark: Benchmark) => save.mutateAsync({ kpi: spec.id as KpiId, benchmark }));
  const set = (key: keyof Benchmark, text: string) => {
    const n = text.trim() === "" ? null : Number(text);
    if (n != null && (!Number.isFinite(n) || n < 0)) return;
    const next = { ...draft, [key]: n };
    setDraft(next);
    auto.schedule(next);
  };
  const problem = benchmarkProblem(draft, spec);
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
      <div className="grid grid-cols-3 gap-2">
        {FIELDS.map(({ key, label }) => (
          <label key={key} className="text-xs font-medium text-muted-foreground">
            {label}
            <input
              inputMode="decimal"
              value={draft[key] ?? ""}
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
