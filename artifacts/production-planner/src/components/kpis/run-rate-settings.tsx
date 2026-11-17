/**
 * TCK run rate — targets and settings, on Analytics → KPIs (17 Nov 2026).
 * Everything that sets or colours the run rate, in one card:
 *   - the line standard (code constant; also sets each day's planned finish),
 *   - the restart allowance (app setting run_rate_restart_allowance_minutes,
 *     same key Settings → Production edits),
 *   - each building table's target and minimum (timing standards, same
 *     endpoint Settings → Production edits).
 * Edits autosave with a visible save state; who may edit is the same rule as
 * Settings → Production. Nothing here changes how the run rate is worked out.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Settings2 } from "lucide-react";
import {
  getListTimingStandardsQueryKey, updateTimingStandard, useListTimingStandards,
} from "@workspace/api-client-react";
import { BUILDING_TARGET_BATCHES_PER_HOUR } from "@workspace/production-schedule";
import { SaveChip } from "@/components/save-chip";
import { useAutosave } from "@/hooks/use-autosave";
import { useFeatureAccess } from "@/hooks/use-feature-access";
import { BAND_RATIOS } from "@/lib/station-kpi-bands";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const ALLOWANCE_KEY = "run_rate_restart_allowance_minutes";
const ALLOWANCE_DEFAULT = 7;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function NumberField({ label, value, onChange, onBlur, disabled, step = "0.5", suffix }: {
  label: string; value: string; onChange: (v: string) => void; onBlur: () => void; disabled: boolean; step?: string; suffix?: string;
}) {
  return (
    <label className="rounded-2xl bg-secondary/50 p-4 block">
      <span className="text-sm font-semibold text-muted-foreground">{label}</span>
      <span className="mt-1 flex items-baseline gap-2">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={step}
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          aria-label={label}
          className="w-full min-w-0 bg-background border border-border rounded-xl px-3 py-2 text-3xl font-display font-extrabold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-100 disabled:bg-transparent disabled:border-transparent disabled:px-0"
        />
        {suffix && <span className="text-muted-foreground shrink-0">{suffix}</span>}
      </span>
    </label>
  );
}

function AllowanceField({ canEdit }: { canEdit: boolean }) {
  const { data } = useQuery<number>({
    queryKey: ["app-settings", ALLOWANCE_KEY],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/app-settings/${ALLOWANCE_KEY}`, { credentials: "include" });
      if (r.status === 404) return ALLOWANCE_DEFAULT;
      if (!r.ok) throw new Error("Couldn't load");
      const d = await r.json();
      const n = Number(d?.value);
      return Number.isFinite(n) ? n : ALLOWANCE_DEFAULT;
    },
    staleTime: 5 * 60_000,
  });
  const qc = useQueryClient();
  const [value, setValue] = useState(String(ALLOWANCE_DEFAULT));
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched && data != null) setValue(String(data)); }, [data, touched]);

  const auto = useAutosave<number>(async (n) => {
    const r = await fetch(`${BASE}/api/app-settings/${ALLOWANCE_KEY}`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: String(n) }),
    });
    if (!r.ok) throw new Error("Couldn't save");
    qc.setQueryData(["app-settings", ALLOWANCE_KEY], n);
  });

  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 60;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Restart allowance</h3>
        {canEdit && <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}
      </div>
      <NumberField
        label="Minutes added to each break"
        value={value}
        step="1"
        suffix="min"
        disabled={!canEdit}
        onChange={v => {
          setTouched(true);
          setValue(v);
          const m = Number(v);
          if (v.trim() !== "" && Number.isInteger(m) && m >= 0 && m <= 60) auto.schedule(m);
        }}
        onBlur={() => void auto.flush()}
      />
      {touched && !valid && <p className="text-sm font-semibold text-red-600">A whole number from 0 to 60. Not saved.</p>}
      {valid && <p className="text-sm text-muted-foreground">Snack + {n}, lunch + {n} (lunch only when production stops for 40 minutes).</p>}
    </div>
  );
}

interface Standard { id: number; stationLabel?: string; minBatchesPerHour?: number | string; targetBatchesPerHour?: number | string }

function TableRow({ s, canEdit }: { s: Standard; canEdit: boolean }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState(String(Number(s.targetBatchesPerHour ?? 0)));
  const [min, setMin] = useState(String(Number(s.minBatchesPerHour ?? 0)));
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    setTarget(String(Number(s.targetBatchesPerHour ?? 0)));
    setMin(String(Number(s.minBatchesPerHour ?? 0)));
  }, [s.targetBatchesPerHour, s.minBatchesPerHour, touched]);

  const auto = useAutosave<{ target: number; min: number }>(async (v) => {
    await updateTimingStandard(s.id, { targetBatchesPerHour: v.target, minBatchesPerHour: v.min });
    await qc.invalidateQueries({ queryKey: getListTimingStandardsQueryKey() });
  });

  const problem = (t: number, m: number) =>
    !Number.isFinite(t) || !Number.isFinite(m) || t < 0 || m < 0 ? "Numbers of 0 or more."
    : m > t ? "The minimum can't be above the target."
    : null;
  const change = (field: "target" | "min", v: string) => {
    setTouched(true);
    const next = { target: Number(field === "target" ? v : target), min: Number(field === "min" ? v : min) };
    if (field === "target") setTarget(v); else setMin(v);
    if (v.trim() !== "" && !problem(next.target, next.min)) auto.schedule(next);
  };
  const shownProblem = touched ? problem(Number(target), Number(min)) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{s.stationLabel ?? "Building table"}</h3>
        {canEdit && <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Target" value={target} disabled={!canEdit} onChange={v => change("target", v)} onBlur={() => void auto.flush()} />
        <NumberField label="Minimum" value={min} disabled={!canEdit} onChange={v => change("min", v)} onBlur={() => void auto.flush()} />
      </div>
      {shownProblem && <p className="text-sm font-semibold text-red-600">{shownProblem} Not saved.</p>}
    </div>
  );
}

export function RunRateSettings() {
  const { can } = useFeatureAccess();
  const canEdit = can("settings.production");
  const { data: timing } = useListTimingStandards();
  const tables = ((timing ?? []) as Standard[]);
  const std = BUILDING_TARGET_BATCHES_PER_HOUR;

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-5 lg:p-6 space-y-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="w-12 h-12 rounded-2xl bg-secondary text-muted-foreground flex items-center justify-center shrink-0"><Settings2 className="w-6 h-6" /></span>
        <h2 className="text-2xl font-display font-extrabold flex-1">Targets &amp; settings</h2>
        {!canEdit && <span className="flex items-center gap-1 text-sm text-muted-foreground"><Lock className="w-4 h-4" /> View only</span>}
      </div>

      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-4">
        <div className="space-y-2">
          <h3 className="font-semibold">Line standard</h3>
          <div className="rounded-2xl bg-secondary/50 p-4">
            <span className="text-sm font-semibold text-muted-foreground">Batches an hour</span>
            <span className="mt-1 block text-3xl font-display font-extrabold tabular-nums">{fmt(std)}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {fmt(Math.round(std * BAND_RATIOS.platinum * 10) / 10)}+ platinum · {fmt(std)}+ green · {fmt(Math.round(std * BAND_RATIOS.amber * 10) / 10)}+ yellow · below that red.
            Also sets each day's planned finish, so it isn't changed here — ask Claude.
          </p>
        </div>
        <AllowanceField canEdit={canEdit} />
        {tables.map(s => <TableRow key={s.id} s={s} canEdit={canEdit} />)}
      </div>
    </section>
  );
}
