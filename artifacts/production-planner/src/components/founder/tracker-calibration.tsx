// Keeping the profit tracker honest (Graeme, 18 Nov 2026; Objective I):
// predicted vs QuickBooks for recent complete months, the prices it uses,
// and which tracker line each QuickBooks account counts towards. Every field
// saves as it changes, with its state shown.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchComparison, fetchGroups, fetchTrackerSettings, saveGroup, saveTrackerSetting,
  gbp0, monthLabel, type Bucket, type TrackerSettings,
} from "./profit-tracker-api";

type SaveState = "idle" | "saving" | "saved" | "error";

function SaveMark({ state }: { state: SaveState }) {
  if (state === "saving") return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  if (state === "saved") return <Check className="w-4 h-4 text-green-600" />;
  if (state === "error") return <AlertTriangle className="w-4 h-4 text-destructive" />;
  return <span className="w-4 h-4" />;
}

function useInvalidateTracker() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["pnl-tracker-predict"] });
    void qc.invalidateQueries({ queryKey: ["pnl-tracker-compare"] });
    void qc.invalidateQueries({ queryKey: ["pnl-tracker-groups"] });
  };
}

// ── Predicted vs QuickBooks ─────────────────────────────────────────────

export function PredictedVsActual() {
  const [on, setOn] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["pnl-tracker-compare"],
    queryFn: fetchComparison,
    enabled: on,
    staleTime: 30 * 60 * 1000,
  });
  return (
    <section className="glass-panel rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-display font-bold">Predicted vs QuickBooks</h2>
          <p className="text-sm text-muted-foreground">The tracker's figures for each recent complete month beside the books.</p>
        </div>
        {!on && (
          <button onClick={() => setOn(true)} className="h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
            Compare
          </button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Couldn't compare"}</p>}
      {on && isLoading && <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-80" />)}</div>}
      {data && (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {data.months.map(m => (
            <div key={m.month} className="rounded-2xl bg-secondary/40 p-4">
              <h3 className="font-display font-bold mb-2">{monthLabel(m.month)}</h3>
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-medium py-1" />
                    <th className="text-right font-medium py-1">Predicted</th>
                    <th className="text-right font-medium py-1">QuickBooks</th>
                    <th className="text-right font-medium py-1">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {m.rows.filter(r => r.predicted !== 0 || r.actual !== 0).map(r => {
                    const total = r.key === "gross_profit" || r.key === "operating_profit" || r.key === "income";
                    const off = r.actual !== 0 ? Math.abs(r.gap / r.actual) : 0;
                    return (
                      <tr key={r.key} className={`border-t border-border ${total ? "font-semibold" : ""}`}>
                        <td className="py-1.5">{r.label}</td>
                        <td className="text-right py-1.5">{gbp0.format(r.predicted)}</td>
                        <td className="text-right py-1.5">{gbp0.format(r.actual)}</td>
                        <td className={`text-right py-1.5 ${off > 0.1 ? "text-amber-700 font-semibold" : "text-muted-foreground"}`}>
                          {r.gap > 0 ? "+" : ""}{gbp0.format(r.gap)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      {data && (
        <p className="text-xs text-muted-foreground">
          Gap = QuickBooks − predicted; amber when over 10%. Food is booked when bought, so one month can swing either way — look across months.
        </p>
      )}
    </section>
  );
}

// ── Prices and grouping ─────────────────────────────────────────────────

type FieldKey = keyof Omit<TrackerSettings, "weightThresholdGrams" | "overhead_average_months" | "target_order_margin">;
type Field = { key: FieldKey; label: string; unit: "£" | "%" };

const PRICE_FIELDS: Field[] = [
  { key: "small_box_cost", label: "Small box, insulation & ice", unit: "£" },
  { key: "large_box_cost", label: "Large box, insulation & ice", unit: "£" },
  { key: "small_box_courier", label: "Courier, small box", unit: "£" },
  { key: "large_box_courier", label: "Courier, large box", unit: "£" },
];

// What Planday's wages are grossed up by for production labour.
const LABOUR_FIELDS: Field[] = [
  { key: "employer_ni_rate", label: "Employer's NI", unit: "%" },
  { key: "employer_ni_weekly_threshold", label: "NI weekly threshold", unit: "£" },
  { key: "employment_allowance_annual", label: "Employment allowance a year", unit: "£" },
  { key: "employer_pension_rate", label: "Employer pension", unit: "%" },
];

const show = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

export function PriceField({ label, unit, value, onSave }: { label: string; unit: "£" | "%"; value: number; onSave: (v: number) => Promise<unknown> }) {
  const [text, setText] = useState(show(value));
  const [state, setState] = useState<SaveState>("idle");
  useEffect(() => { setText(show(value)); }, [value]);
  async function commit() {
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0 || n === value) { setText(show(value)); return; }
    setState("saving");
    try { await onSave(n); setState("saved"); } catch { setState("error"); }
  }
  return (
    <label className="rounded-2xl bg-secondary/40 p-4 block">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        {unit === "£" && <span className="text-lg font-semibold">£</span>}
        <input
          inputMode="decimal"
          value={text}
          onChange={e => { setText(e.target.value); setState("idle"); }}
          onBlur={() => void commit()}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="h-11 w-28 rounded-lg border border-border bg-background px-3 text-lg font-semibold tabular-nums"
        />
        {unit === "%" && <span className="text-lg font-semibold">%</span>}
        <SaveMark state={state} />
      </div>
    </label>
  );
}

export function TrackerSetup() {
  const invalidate = useInvalidateTracker();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["pnl-tracker-settings"], queryFn: fetchTrackerSettings });
  const groups = useQuery({ queryKey: ["pnl-tracker-groups"], queryFn: fetchGroups, staleTime: 10 * 60 * 1000 });
  const [rowState, setRowState] = useState<Record<string, SaveState>>({});

  const saveSetting = useMutation({
    mutationFn: ({ key, value }: { key: Parameters<typeof saveTrackerSetting>[0]; value: number }) => saveTrackerSetting(key, value),
    onSuccess: s => { qc.setQueryData(["pnl-tracker-settings"], s); invalidate(); },
  });

  async function setBucket(name: string, key: string, bucket: Bucket | null) {
    setRowState(s => ({ ...s, [key]: "saving" }));
    try {
      await saveGroup(name, bucket);
      setRowState(s => ({ ...s, [key]: "saved" }));
      invalidate();
    } catch {
      setRowState(s => ({ ...s, [key]: "error" }));
    }
  }

  const s = settings.data;
  const g = groups.data;
  const toCheck = g?.accounts.filter(a => a.source === "default" && a.bucket === "other_cost_of_sales" && a.total !== 0) ?? [];

  return (
    <section className="glass-panel rounded-2xl p-5 space-y-5">
      <div>
        <h2 className="text-lg font-display font-bold">Tracker prices, labour and QuickBooks lines</h2>
        <p className="text-sm text-muted-foreground">Saves as you change it.</p>
      </div>

      {s ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {PRICE_FIELDS.map(f => (
            <PriceField key={f.key} label={f.label} unit={f.unit} value={s[f.key]} onSave={v => saveSetting.mutateAsync({ key: f.key, value: v })} />
          ))}
          <div className="rounded-2xl bg-secondary/40 p-4">
            <span className="text-sm text-muted-foreground">Overheads averaged over</span>
            <div className="mt-1 flex items-center gap-2">
              {[3, 6].map(n => (
                <button
                  key={n}
                  onClick={() => saveSetting.mutate({ key: "overhead_average_months", value: n })}
                  className={`h-11 px-4 rounded-lg text-sm font-medium border ${s.overhead_average_months === n ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}`}
                >
                  {n} months
                </button>
              ))}
              <SaveMark state={saveSetting.isPending ? "saving" : saveSetting.isError ? "error" : "idle"} />
            </div>
          </div>
        </div>
      ) : <Skeleton className="h-24" />}

      {s && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">Labour on-costs, added to Planday wages</h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {LABOUR_FIELDS.map(f => (
              <PriceField key={f.key} label={f.label} unit={f.unit} value={s[f.key]} onSave={v => saveSetting.mutateAsync({ key: f.key, value: v })} />
            ))}
          </div>
        </div>
      )}

      {toCheck.length > 0 && (
        <p className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-sm text-amber-900 dark:text-amber-200">
          {toCheck.length} cost-of-sales line{toCheck.length === 1 ? "" : "s"} not grouped yet: {toCheck.map(a => a.name).join(", ")}.
        </p>
      )}

      <details>
        <summary className="cursor-pointer text-primary font-medium text-sm">Which line each QuickBooks account counts towards</summary>
        {groups.error && <p className="mt-2 text-sm text-destructive">{groups.error instanceof Error ? groups.error.message : "Couldn't load"}</p>}
        {g ? (
          <div className="mt-3 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Account</th>
                  <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">
                    {g.months.length ? `${monthLabel(g.months[0]!)} – ${monthLabel(g.months[g.months.length - 1]!)}` : ""}
                  </th>
                  <th className="text-left font-semibold px-3 py-2">Counts as</th>
                </tr>
              </thead>
              <tbody>
                {g.accounts.map(a => (
                  <tr key={a.key} className="border-t border-border">
                    <td className="px-3 py-1.5" style={{ paddingLeft: `${0.75 + (a.depth - 1) * 1.1}rem` }}>
                      <span className={a.isLeaf ? "" : "font-semibold"}>{a.name}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">{a.total ? gbp0.format(a.total) : ""}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <select
                          value={a.source === "set" ? a.bucket : ""}
                          onChange={e => void setBucket(a.name, a.accountKey, e.target.value ? (e.target.value as Bucket) : null)}
                          className="h-10 rounded-lg border border-border bg-background px-2"
                        >
                          <option value="">
                            {a.source === "inherited" ? `Same as above (${g.buckets.find(b => b.key === a.bucket)?.label})` : `Default (${g.buckets.find(b => b.key === a.bucket)?.label})`}
                          </option>
                          {g.buckets.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                        </select>
                        <SaveMark state={rowState[a.accountKey] ?? "idle"} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : groups.isLoading ? <Skeleton className="h-40 mt-3" /> : null}
      </details>
    </section>
  );
}
