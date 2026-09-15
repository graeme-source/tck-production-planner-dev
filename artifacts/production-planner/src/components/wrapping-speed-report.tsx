/**
 * Wrapping Speed section for Analytics → Production KPIs (Graeme,
 * 2026-09-15): the station's packs/hour KPI over the report's date range,
 * per day and per person. Same maths as the live station strip (20-minute
 * idle gaps pause the clock), so the numbers here match what the wrapper
 * saw at the bench. Colour bands mirror the strip: 180 standard / 240
 * stretch. Lives in its own file because pages/reports.tsx is frozen.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Gift, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface DayPace { date: string; packs: number; submissions: number; activeMinutes: number | null; idleMinutes: number | null; packsPerHour: number | null }
interface PersonPace { userId: number; name: string; packs: number; daysWorked: number; activeMinutes: number; packsPerHour: number | null; days: DayPace[] }

const STANDARD = 180;
const STRETCH = 240;

const rateTone = (rate: number | null) =>
  rate == null ? "text-muted-foreground"
  : rate >= STRETCH ? "text-emerald-600 font-bold"
  : rate >= STANDARD ? "text-emerald-700 font-semibold"
  : rate >= STANDARD * 0.8 ? "text-amber-600 font-semibold"
  : "text-rose-600 font-semibold";

const fmtMins = (mins: number | null) =>
  mins == null ? "—" : mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;

const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function WrappingSpeedReport({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showDays, setShowDays] = useState(false);

  const { data, isLoading } = useQuery<{ days: DayPace[]; people: PersonPace[] }>({
    queryKey: ["wrapping-speed-history", fromDate, toDate],
    enabled: !!fromDate && !!toDate,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/reports/wrapping-speed-history?from=${fromDate}&to=${toDate}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load wrapping speed");
      return r.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data || (data.days.length === 0 && data.people.length === 0)) {
    return (
      <div className="mt-8">
        <h3 className="font-semibold flex items-center gap-2 mb-3"><Gift className="w-4 h-4 text-purple-500" /> Wrapping Speed</h3>
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
          No wrapping activity recorded in this date range.
        </div>
      </div>
    );
  }

  const toggle = (id: number) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const totalPacks = data.days.reduce((s, d) => s + d.packs, 0);
  const totalActive = data.days.reduce((s, d) => s + (d.activeMinutes ?? 0), 0);
  const overallRate = totalActive > 1 ? Math.round(totalPacks / (totalActive / 60)) : null;

  return (
    <div className="mt-8 space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <Gift className="w-4 h-4 text-purple-500" /> Wrapping Speed
        <span className="text-xs font-normal text-muted-foreground">packs/hour of active time · standard {STANDARD} · stretch {STRETCH}</span>
      </h3>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground font-medium">Packs wrapped</p>
          <p className="text-2xl font-display font-bold tabular-nums">{totalPacks}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground font-medium">Active wrapping time</p>
          <p className="text-2xl font-display font-bold tabular-nums">{fmtMins(totalActive)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground font-medium">Overall packs / hour</p>
          <p className={cn("text-2xl font-display font-bold tabular-nums", rateTone(overallRate))}>{overallRate ?? "—"}</p>
        </div>
      </div>

      {/* Per person — the ask: pace over a period for different people. */}
      {data.people.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/50 border-b border-border text-muted-foreground">
                <th className="text-left px-4 py-2.5 font-medium">Person</th>
                <th className="text-right px-3 py-2.5 font-medium">Days</th>
                <th className="text-right px-3 py-2.5 font-medium">Packs</th>
                <th className="text-right px-3 py-2.5 font-medium">Active time</th>
                <th className="text-right px-4 py-2.5 font-medium">Packs / hr</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {data.people.map(p => (
                <>
                  <tr key={p.userId} onClick={() => toggle(p.userId)} className="border-b border-border last:border-b-0 cursor-pointer hover:bg-secondary/30">
                    <td className="px-4 py-2.5 font-medium">{p.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{p.daysWorked}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{p.packs}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtMins(p.activeMinutes)}</td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums", rateTone(p.packsPerHour))}>{p.packsPerHour ?? "—"}</td>
                    <td className="pr-3 text-muted-foreground">{expanded.has(p.userId) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                  </tr>
                  {expanded.has(p.userId) && p.days.map(d => (
                    <tr key={`${p.userId}-${d.date}`} className="border-b border-border last:border-b-0 bg-secondary/20 text-muted-foreground">
                      <td className="px-4 py-1.5 pl-8 text-xs">{fmtDay(d.date)}</td>
                      <td />
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{d.packs}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{fmtMins(d.activeMinutes)}</td>
                      <td className={cn("px-4 py-1.5 text-right tabular-nums text-xs", rateTone(d.packsPerHour))}>{d.packsPerHour ?? "—"}</td>
                      <td />
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per day, whole team — collapsed by default to keep the tab tight. */}
      <button onClick={() => setShowDays(v => !v)} className="text-sm font-semibold text-primary hover:underline flex items-center gap-1">
        {showDays ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} Day by day ({data.days.length})
      </button>
      {showDays && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/50 border-b border-border text-muted-foreground">
                <th className="text-left px-4 py-2.5 font-medium">Day</th>
                <th className="text-right px-3 py-2.5 font-medium">Packs</th>
                <th className="text-right px-3 py-2.5 font-medium">Active time</th>
                <th className="text-right px-3 py-2.5 font-medium">Idle</th>
                <th className="text-right px-4 py-2.5 font-medium">Packs / hr</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map(d => (
                <tr key={d.date} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5 font-medium">{fmtDay(d.date)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{d.packs}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtMins(d.activeMinutes)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{fmtMins(d.idleMinutes)}</td>
                  <td className={cn("px-4 py-2.5 text-right tabular-nums", rateTone(d.packsPerHour))}>{d.packsPerHour ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
