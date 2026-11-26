/**
 * The TCK run rate through ONE day, in 15-minute steps (Graeme, 26 Nov 2026:
 * "show the progress throughout the day and how this changed … any sharp
 * jumps or drops … how much lunch is having an effect").
 *
 *   - the line: the run rate as it stood at the end of each 15 minutes —
 *     what the building station showed then (GET /api/run-rate-day),
 *   - the bars: batches built in those 15 minutes, so a dip in pace (lunch,
 *     a slow restart) shows even while the number is being held,
 *   - shaded: the morning snack and the stop the rule took as lunch,
 *   - a labelled line at the standard.
 * Hover (or tap) a step for its time, the number then, and the batches.
 * Objective G.
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Step { at: string; label: string; runRate: number | null; batches: number; batchesSoFar: number; held: boolean }
interface DayData {
  date: string;
  live: boolean;
  steps: Step[];
  final: number | null;
  batches: number;
  snack: { fromMinute: number; toMinute: number };
  lunch: { fromMinute: number; toMinute: number } | null;
  breakMinutesDeducted: number;
  finished: boolean;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;
const toMin = (label: string) => Number(label.slice(0, 2)) * 60 + Number(label.slice(3, 5));
/** The step a clock minute falls in, by its label — for the shaded breaks. */
const stepLabel = (m: number) => clock(Math.floor(m / 15) * 15);

const LINE = "hsl(var(--foreground))";
const BAR = "hsl(var(--primary) / 0.35)";

export function useRunRateDay(date: string) {
  return useQuery<DayData>({
    queryKey: ["run-rate-day", date],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/run-rate-day?date=${date}`, { credentials: "include" });
      if (!r.ok) throw new Error("Couldn't load the day");
      return r.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

function TipBox({ active, payload }: { active?: boolean; payload?: Array<{ payload: Step }> }) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload;
  const end = clock(toMin(s.label) + 15);
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-lg text-sm space-y-1 min-w-48">
      <p className="font-semibold">{s.label}–{end}</p>
      <p className="flex items-center gap-2">
        <span className="w-3 h-0.5 rounded shrink-0" style={{ background: LINE }} />
        <span className="font-bold tabular-nums">{s.runRate == null ? "—" : fmt(s.runRate)}</span>
        <span className="text-muted-foreground">run rate at {end}{s.held ? " (held — no batch for 15 min)" : ""}</span>
      </p>
      <p className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: BAR }} />
        <span className="font-bold tabular-nums">{s.batches}</span>
        <span className="text-muted-foreground">batches in these 15 min ({s.batches * 4} an hour)</span>
      </p>
      <p className="text-muted-foreground">{s.batchesSoFar} batches so far</p>
    </div>
  );
}

export function RunRateDayChart({ date, standard }: { date: string; standard: number }) {
  const { data, isLoading, isError } = useRunRateDay(date);
  if (isLoading) return <p className="py-16 flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Loading the day…</p>;
  if (isError || !data) return <p className="py-12 text-center text-muted-foreground">Couldn't load the day's run rate.</p>;
  if (data.steps.length === 0) return <p className="py-12 text-center text-muted-foreground">No calzone batches built on this day yet.</p>;

  const steps = data.steps;
  const labels = new Set(steps.map(s => s.label));
  const area = (fromMinute: number, toMinute: number) => {
    const a = stepLabel(fromMinute);
    const b = stepLabel(Math.max(fromMinute, toMinute - 0.01));
    return labels.has(a) && labels.has(b) ? { x1: a, x2: b } : null;
  };
  const snack = area(data.snack.fromMinute, data.snack.toMinute);
  const lunch = data.lunch ? area(data.lunch.fromMinute, data.lunch.toMinute) : null;
  const maxRate = Math.max(standard * 1.2, ...steps.map(s => s.runRate ?? 0));
  const maxBatches = Math.max(4, ...steps.map(s => s.batches));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span><span className="font-bold tabular-nums">{data.final == null ? "—" : fmt(data.final)}</span> <span className="text-muted-foreground">{data.live ? "now" : "for the day"}</span></span>
        <span><span className="font-bold tabular-nums">{data.batches}</span> <span className="text-muted-foreground">batches</span></span>
        <span className="text-muted-foreground">{data.breakMinutesDeducted} min of breaks taken off{data.lunch ? ` · lunch read as ${clock(data.lunch.fromMinute)}–${clock(data.lunch.toMinute)}` : " · no lunch stop found"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: LINE }} /> Run rate at the end of each 15 min</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: BAR }} /> Batches in each 15 min</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400/25 border border-amber-500/40" /> Snack and lunch</span>
      </div>
      <div className="h-72 sm:h-80 w-full" role="img" aria-label={`Run rate through ${date} in 15-minute steps`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={steps} margin={{ top: 8, right: 4, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            {snack && <ReferenceArea yAxisId="rate" ifOverflow="hidden" x1={snack.x1} x2={snack.x2} fill="#f59e0b" fillOpacity={0.12} label={{ value: "Snack", position: "insideTop", fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />}
            {lunch && <ReferenceArea yAxisId="rate" ifOverflow="hidden" x1={lunch.x1} x2={lunch.x2} fill="#f59e0b" fillOpacity={0.12} label={{ value: "Lunch", position: "insideTop", fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />}
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} minTickGap={12} interval="preserveStartEnd" />
            <YAxis yAxisId="rate" orientation="left" domain={[0, Math.ceil(maxRate)]} width={36}
              tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="batches" orientation="right" domain={[0, maxBatches * 2]} allowDecimals={false} width={28}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
            <ReferenceLine yAxisId="rate" y={standard} stroke="hsl(var(--primary))" strokeDasharray="4 4"
              label={{ value: `Standard ${standard}`, position: "insideTopLeft", fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip content={<TipBox />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.08)" }} />
            <Bar yAxisId="batches" dataKey="batches" fill={BAR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Line yAxisId="rate" dataKey="runRate" type="linear" stroke={LINE} strokeWidth={2.5}
              dot={{ r: 2.5, fill: LINE, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }}
              connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">
        Each point is the number the building station showed at the end of that 15 minutes. It holds still through a stop, then lunch comes off when building restarts.
        Bars use the right-hand scale.
      </p>
    </div>
  );
}
