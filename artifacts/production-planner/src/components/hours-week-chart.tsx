/**
 * Weekly paid hours as bars, with the contracted hours as a reference line
 * (Objective I). One measure, one axis. A counted week's bar is coloured
 * against the contract — green at or over, amber under; weeks left out of
 * the average (holiday, sickness, absence, part weeks, this week) are
 * hatched grey and say why in the tooltip and the legend.
 */
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid } from "recharts";
import { fmtHours, fmtSigned, weekNote, weekTone, type BarTone, type WeekHours } from "@/lib/hours-worked-view";

const FILL: Record<BarTone, string> = {
  over: "hsl(var(--primary))",
  on: "hsl(var(--primary))",
  under: "#d97706", // amber-600: readable on both themes
  no_contract: "hsl(var(--primary) / 0.7)",
  excluded: "url(#hours-week-hatch)",
};

const fmtWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function TipBox({ active, payload, contracted }: { active?: boolean; payload?: Array<{ payload: WeekHours }>; contracted: number | null }) {
  if (!active || !payload?.length) return null;
  const w = payload[0].payload;
  const note = weekNote(w);
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-lg text-sm max-w-[16rem]">
      <p className="font-semibold text-foreground">Week of {fmtWeek(w.weekStart)}</p>
      <p className="text-muted-foreground">Paid: <span className="font-semibold text-foreground tabular-nums">{fmtHours(w.paidHours)}</span> · {w.shifts} shift{w.shifts === 1 ? "" : "s"}</p>
      {w.vsContract != null && contracted != null && (
        <p className="text-muted-foreground">Against {fmtHours(contracted)} contract: <span className="font-semibold text-foreground tabular-nums">{fmtSigned(w.vsContract)} h</span></p>
      )}
      {note && <p className="text-muted-foreground mt-0.5">{note}</p>}
    </div>
  );
}

export function HoursWeekChart({ weeks, contracted }: { weeks: WeekHours[]; contracted: number | null }) {
  if (weeks.length === 0) return null;
  const max = Math.max(contracted ?? 0, ...weeks.map(w => w.paidHours));
  const top = Math.max(10, Math.ceil((max + 2) / 5) * 5);
  return (
    <div className="space-y-2">
      <div className="h-64 sm:h-72 w-full" role="img"
        aria-label={`Paid hours each week${contracted != null ? `, with a line at the contracted ${contracted} hours` : ""}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={weeks} margin={{ top: 16, right: 8, bottom: 4, left: -12 }} barCategoryGap={2}>
            <defs>
              <pattern id="hours-week-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="hsl(var(--muted-foreground) / 0.18)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--muted-foreground) / 0.55)" strokeWidth="2" />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis dataKey="weekStart" tickFormatter={fmtWeek} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis domain={[0, top]} tickFormatter={v => `${v}h`} width={44}
              tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
            <Tooltip content={<TipBox contracted={contracted} />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.08)" }} />
            <Bar dataKey="paidHours" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={36}>
              {weeks.map(w => <Cell key={w.weekStart} fill={FILL[weekTone(w, contracted)]} />)}
            </Bar>
            {contracted != null && (
              <ReferenceLine y={contracted} stroke="hsl(var(--foreground))" strokeOpacity={0.6} strokeDasharray="6 4" strokeWidth={2}
                label={{ value: `Contract ${fmtHours(contracted)}`, position: "insideTopRight", fill: "hsl(var(--foreground))", fontSize: 12 }} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        {contracted != null ? (
          <>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm bg-primary" /> At or over contract</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm" style={{ background: FILL.under }} /> Under contract</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-foreground/60" /> Contracted hours</span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm bg-primary/70" /> Paid hours</span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <svg width="14" height="14" aria-hidden><rect width="14" height="14" rx="2" fill="url(#hours-week-hatch)" /></svg>
          Holiday, sickness, absence or part week — not counted
        </span>
      </div>
    </div>
  );
}
