/**
 * Improvement time on the KPIs (Graeme, 27 Nov 2026: "it doesn't negatively
 * affect their KPIs if it slows them down … I want to see the breakdown").
 * Shown beside the TCK run rate and the packing & wrapping room score on
 * Analytics → KPIs:
 *
 *   ImprovementCreditCard     how many improvements, minutes credited, who
 *                             earned them, and the score with vs without
 *   ImprovementMinutesSetting minutes per improvement (managers and admins,
 *                             autosaves with a visible save state)
 *
 * The rules live on the server (api lib/improvement-kpi-credit.ts).
 * Objective E.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Lock } from "lucide-react";
import { SaveChip } from "@/components/save-chip";
import { useAutosave } from "@/hooks/use-autosave";
import type { ImprovementCredit, RangeImprovementCredit } from "@/hooks/use-run-rate-report";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const SETTINGS_KEY = ["improvement-kpi-credit", "settings"] as const;

const mins = (n: number) => {
  const m = Math.round(n);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`;
};

const REASON: Record<RangeImprovementCredit["notCounted"][number]["reason"], string> = {
  "no-shift": "no shift that day",
  "not-linked": "not linked to Planday",
  "other-shift": "not on a production shift",
  "planday-unavailable": "Planday couldn't be read",
};

export function ImprovementCreditCard({
  credit, withScore, withoutScore, scoreUnit, periodWords, notCounted, otherTeam, unavailable, inset = false,
}: {
  credit: ImprovementCredit | null | undefined;
  withScore: string;
  withoutScore: string;
  /** e.g. "batches an hour", "% of a typical day" */
  scoreUnit: string;
  /** e.g. "these days", "Wed 26 Nov" */
  periodWords: string;
  notCounted?: RangeImprovementCredit["notCounted"];
  /** People whose improvements counted on the other KPI. */
  otherTeam?: { label: string; people: ImprovementCredit["people"] };
  unavailable?: string | null;
  /** Inside another card: a lighter panel instead of a card of its own. */
  inset?: boolean;
}) {
  const c = credit ?? { improvements: 0, minutes: 0, minutesApplied: 0, people: [] };
  const capped = c.minutesApplied + 0.5 < c.minutes;
  return (
    <section className={inset ? "rounded-2xl border border-border p-4 space-y-4" : "rounded-3xl border-2 border-border bg-card p-5 lg:p-6 shadow-sm space-y-4"}>
      <div className="flex items-start gap-3">
        <span className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 flex items-center justify-center shrink-0"><Lightbulb className="w-6 h-6" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-display font-extrabold">Improvement time</h2>
          <p className="text-muted-foreground">Time spent on improvements counts as work at 100%, so improving never costs the team.</p>
        </div>
      </div>

      {unavailable && <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">{unavailable} — nothing credited until it can be.</p>}

      {c.improvements === 0 ? (
        <p className="text-lg text-muted-foreground">No improvements counted on {periodWords}.</p>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
            <Tile label="Improvements" value={String(c.improvements)} />
            <Tile label="Time credited" value={mins(c.minutesApplied)} sub={capped ? `of ${mins(c.minutes)} — never more than half the day` : undefined} />
            <Tile label="With the credit" value={withScore} sub={scoreUnit} />
            <Tile label="Without it" value={withoutScore} sub={scoreUnit} />
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold">Who earned it</h3>
            <div className="flex flex-wrap gap-2">
              {c.people.map(p => (
                <span key={p.userId} className="rounded-full bg-secondary px-3 py-1.5 text-base">
                  <span className="font-semibold">{p.name ?? "Someone"}</span>
                  <span className="text-muted-foreground"> · {p.improvements} improvement{p.improvements === 1 ? "" : "s"}, {mins(p.minutes)}</span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {((notCounted?.length ?? 0) > 0 || (otherTeam?.people.length ?? 0) > 0) && (
        <details className="rounded-2xl border border-border">
          <summary className="cursor-pointer px-4 py-3 font-semibold">Done, but not counted here</summary>
          <ul className="border-t border-border divide-y divide-border">
            {otherTeam?.people.map(p => (
              <li key={`o${p.userId}`} className="px-4 py-2">
                <span className="font-semibold">{p.name ?? "Someone"}</span>
                <span className="text-muted-foreground"> · {p.improvements} · counted on {otherTeam.label}</span>
              </li>
            ))}
            {notCounted?.map(p => (
              <li key={`n${p.userId}-${p.reason}`} className="px-4 py-2">
                <span className="font-semibold">{p.name ?? "Someone"}</span>
                <span className="text-muted-foreground"> · {p.improvements} · {REASON[p.reason]}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-secondary/50 p-4 min-w-0">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-display font-extrabold tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

interface Settings { minutesPerImprovement: number; canEdit: boolean }

export function ImprovementMinutesSetting() {
  const qc = useQueryClient();
  const { data } = useQuery<Settings>({
    queryKey: SETTINGS_KEY,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/improvement-kpi-credit/settings`, { credentials: "include" });
      if (!r.ok) throw new Error("Couldn't load");
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  const [value, setValue] = useState("10");
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched && data) setValue(String(data.minutesPerImprovement)); }, [data, touched]);

  const auto = useAutosave<number>(async (n) => {
    const r = await fetch(`${BASE}/api/improvement-kpi-credit/settings`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutesPerImprovement: n }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't save");
    qc.setQueryData<Settings>(SETTINGS_KEY, old => old ? { ...old, minutesPerImprovement: n } : old);
    // The figures that use it.
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["reports", "production-kpis"] }),
      qc.invalidateQueries({ queryKey: ["production-kpis", "room"] }),
      qc.invalidateQueries({ queryKey: ["run-rate-day"] }),
      qc.invalidateQueries({ queryKey: ["room-day"] }),
    ]);
  });

  const canEdit = data?.canEdit ?? false;
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 120;
  return (
    <section className="rounded-3xl border-2 border-border bg-card p-5 lg:p-6 shadow-sm space-y-3">
      <div className="flex items-center gap-3">
        <span className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 flex items-center justify-center shrink-0"><Lightbulb className="w-6 h-6" /></span>
        <h2 className="text-2xl font-display font-extrabold flex-1">Time per improvement</h2>
        {canEdit ? <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
          : <span className="flex items-center gap-1 text-sm text-muted-foreground"><Lock className="w-4 h-4" /> View only</span>}
      </div>
      <label className="rounded-2xl bg-secondary/50 p-4 block max-w-xs">
        <span className="text-sm font-semibold text-muted-foreground">Minutes for each person credited</span>
        <span className="mt-1 flex items-baseline gap-2">
          <input
            type="number" inputMode="numeric" min={0} max={120} step="1"
            value={value} disabled={!canEdit} aria-label="Minutes per improvement"
            onChange={e => {
              setTouched(true);
              setValue(e.target.value);
              const m = Number(e.target.value);
              if (e.target.value.trim() !== "" && Number.isInteger(m) && m >= 0 && m <= 120) auto.schedule(m);
            }}
            onBlur={() => void auto.flush()}
            className="w-full min-w-0 bg-background border border-border rounded-xl px-3 py-2 text-3xl font-display font-extrabold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-100 disabled:bg-transparent disabled:border-transparent disabled:px-0"
          />
          <span className="text-muted-foreground shrink-0">min</span>
        </span>
      </label>
      {touched && !valid && <p className="text-sm font-semibold text-red-600">A whole number from 0 to 120. Not saved.</p>}
      <p className="text-sm text-muted-foreground max-w-prose">
        Each improvement done earns everyone credited on it this much time. Packer and Wrapper shifts count it on the room score, other production shifts on the TCK run rate. Boxes and packs per hour don't change.
      </p>
    </section>
  );
}
