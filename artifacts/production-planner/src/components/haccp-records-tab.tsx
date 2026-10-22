/**
 * Analytics -> HACCP -> Readings & Cook-Chill (Objective D).
 *
 *   Checklist readings  numbers typed on checklist items, e.g. the Monday
 *                       scale calibration (issues #87/#169)
 *
 * Its own file so pages/reports.tsx only wires the tab in (charter rule 4).
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2, Gauge, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { readingRangeText } from "@/lib/checklist-reading-input";

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
    </div>
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
