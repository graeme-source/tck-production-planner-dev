/**
 * Analytics -> HACCP -> Readings & Cook-Chill (Objective D).
 *
 *   Checklist readings  numbers typed on checklist items, e.g. the Monday
 *                       scale calibration (issues #87/#169)
 *   Cook and chill      cooked sub-recipes: core temp at cook-out (FSA
 *                       table), into the blast chiller, chilling finished (#244)
 *   Cooling log         every cooling cycle — calzones (#85) and cooked
 *                       sub-recipes — in one list, one duration rule
 *
 * Its own file so pages/reports.tsx only wires the tab in (charter rule 4).
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2, Gauge, CheckCircle2, AlertTriangle, ThermometerSnowflake, Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import { readingRangeText } from "@/lib/checklist-reading-input";
import { formatHold } from "@/lib/cook-standards";
import { cookMet, clockText, minutesText, type CookChillRecordView } from "@/lib/cook-chill-view";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ReadingLogRow {
  id: number;
  templateId: number;
  title: string;
  stationType: string;
  label: string;
  value: number;
  unit: string;
  expectedMin: number | null;
  expectedMax: number | null;
  inRange: boolean | null;
  recordedByName: string;
  recordedAt: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Couldn't load (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function stationName(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function HaccpRecordsTab({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  return (
    <div className="space-y-6">
      <ChecklistReadingsSection fromDate={fromDate} toDate={toDate} />
      <CookChillSections fromDate={fromDate} toDate={toDate} />
    </div>
  );
}

interface CoolingCycleRow {
  source: "calzone" | "sub_recipe";
  recordId: number;
  name: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  startedByName: string | null;
  finishedByName: string | null;
  via: string | null;
}

function viaText(via: string | null): string {
  return via ? via.replace(/_/g, " ") : "";
}

function CookChillSections({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const q = useQuery({
    queryKey: ["cook-chill-log", fromDate, toDate],
    queryFn: () => getJson<{ records: CookChillRecordView[]; cooling: CoolingCycleRow[]; chillTargetTempC: number }>(
      `${BASE}/api/cook-chill/log?from=${fromDate}&to=${toDate}`,
    ),
  });
  const records = q.data?.records ?? [];
  const cooling = q.data?.cooling ?? [];
  const finished = cooling.filter(c => c.durationMinutes != null);
  const avg = finished.length
    ? Math.round(finished.reduce((s, c) => s + (c.durationMinutes ?? 0), 0) / finished.length)
    : null;

  return (
    <>
      <section className="bg-card border border-border rounded-2xl p-5">
        <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
          <ThermometerSnowflake className="w-5 h-5 text-cyan-600" /> Cook and chill — sub-recipes
        </h3>
        {q.isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : q.isError ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No cook-and-chill records in this date range. Tick "Cook and chill" on a sub-recipe (Sub-Recipes → Edit)
            and Prep can record it.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {records.map(r => {
              const met = cookMet(r);
              return (
                <div key={r.id} className={cn("rounded-xl border-2 p-4 space-y-1", met ? "border-border" : "border-amber-300")}>
                  <p className="font-semibold">{r.subRecipeName}</p>
                  <p className={cn("text-sm font-semibold", met ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
                    Cooked {r.cookTempC}°C for {formatHold(r.cookHeldForSeconds)} {met ? "✓ meets the FSA table" : "— below the FSA table"}
                  </p>
                  <p className="text-sm text-muted-foreground">{r.cookedByName} · {when(r.cookedAt)}</p>
                  <p className="text-sm">
                    {r.chillStartAt
                      ? <>Into blast chiller {clockText(r.chillStartAt)}{r.chillStartByName ? ` (${r.chillStartByName})` : ""}</>
                      : <span className="text-amber-700 dark:text-amber-400 font-semibold">Not marked into the blast chiller</span>}
                  </p>
                  <p className="text-sm">
                    {r.chillEndAt && r.chillStartAt
                      ? <>Chilling finished {clockText(r.chillEndAt)} — {minutesText(r.chillStartAt, r.chillEndAt)}{r.chillEndByName ? ` (${r.chillEndByName}, ${viaText(r.chilledVia)})` : ""}</>
                      : r.chillStartAt
                        ? <span className="text-amber-700 dark:text-amber-400 font-semibold">Chilling not marked finished</span>
                        : null}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="bg-card border border-border rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Hourglass className="w-5 h-5 text-primary" /> Cooling log — calzones and cooked sub-recipes
          </h3>
          {avg != null && (
            <span className="text-sm font-semibold text-muted-foreground">
              {finished.length} finished · average {avg} min · chill to {q.data?.chillTargetTempC ?? 4}°C
            </span>
          )}
        </div>
        {q.isLoading ? null : cooling.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cooling cycles in this date range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-semibold">What</th>
                  <th className="py-2 pr-3 font-semibold">Into chiller</th>
                  <th className="py-2 pr-3 font-semibold">Finished</th>
                  <th className="py-2 pr-3 font-semibold">Time</th>
                  <th className="py-2 font-semibold">Who / where</th>
                </tr>
              </thead>
              <tbody>
                {cooling.map(c => (
                  <tr key={`${c.source}-${c.recordId}`} className="border-b border-border/60">
                    <td className="py-2 pr-3 font-medium">
                      {c.name}
                      <span className="ml-2 text-xs text-muted-foreground">{c.source === "calzone" ? "calzone" : "sub-recipe"}</span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{when(c.startAt)}</td>
                    <td className="py-2 pr-3 tabular-nums">{c.endAt ? clockText(c.endAt) : <span className="text-amber-700 dark:text-amber-400 font-semibold">not marked</span>}</td>
                    <td className="py-2 pr-3 tabular-nums font-semibold">{c.durationMinutes != null ? `${c.durationMinutes} min` : "—"}</td>
                    <td className="py-2 text-muted-foreground">{[c.finishedByName ?? c.startedByName, viaText(c.via)].filter(Boolean).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function ChecklistReadingsSection({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const q = useQuery({
    queryKey: ["checklist-readings-log", fromDate, toDate],
    queryFn: () => getJson<{ readings: ReadingLogRow[] }>(`${BASE}/api/checklist-readings/log?from=${fromDate}&to=${toDate}`),
  });
  const rows = q.data?.readings ?? [];
  const outOfRange = rows.filter(r => r.inRange === false).length;

  return (
    <section className="bg-card border border-border rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Gauge className="w-5 h-5 text-primary" /> Checklist readings
        </h3>
        {rows.length > 0 && (
          <span className={cn("text-sm font-semibold", outOfRange ? "text-red-600" : "text-emerald-600")}>
            {rows.length} reading{rows.length === 1 ? "" : "s"}{outOfRange ? ` · ${outOfRange} out of range` : " · all in range or no range set"}
          </span>
        )}
      </div>
      {q.isLoading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : q.isError ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No readings in this date range. A checklist item records a reading once a manager ticks
          "Record a reading" on it in the station's checklist setup (e.g. Building 1 → Calibrate scales).
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(r => {
            const range = readingRangeText(r.expectedMin, r.expectedMax, r.unit);
            return (
              <div
                key={r.id}
                className={cn(
                  "rounded-xl border-2 p-4",
                  r.inRange === false ? "border-red-300 bg-red-50/40 dark:bg-red-950/10"
                    : r.inRange === true ? "border-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/10"
                    : "border-border",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold leading-tight">{r.title}{r.label ? ` — ${r.label}` : ""}</p>
                    <p className="text-sm text-muted-foreground">{stationName(r.stationType)}</p>
                  </div>
                  {r.inRange === true && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" aria-label="In range" />}
                  {r.inRange === false && <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" aria-label="Out of range" />}
                </div>
                <p className="text-3xl font-bold tabular-nums mt-2">{r.value} <span className="text-lg text-muted-foreground">{r.unit}</span></p>
                {range && <p className="text-sm text-muted-foreground">{range}</p>}
                <p className="text-sm text-muted-foreground mt-1">{r.recordedByName} · {when(r.recordedAt)}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
