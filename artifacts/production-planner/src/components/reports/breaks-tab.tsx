import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, Clock, Coffee, Loader2, Minus as MinusIcon, StickyNote, Users, Utensils } from "lucide-react";
import { cn } from "@/lib/utils";
import { SummaryCard } from "./summary-card";

// Analytics → Breaks & Lunches. Moved out of pages/reports.tsx (Development
// Charter rule 4) when the break note was added (Fix queue #61), and moved
// onto React Query at the same time.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface BreakRecord {
  id: number;
  planId: number;
  planDate: string | null;
  stationType: string;
  userId: number | null;
  userName: string;
  breakType: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  allowedMinutes: number;
  overUnder: number;
  /** Optional "Anything to note?" from the break screen (#61). */
  note?: string | null;
}

interface UserSummary {
  userId: number;
  userName: string;
  avgBreakMinutes: number | null;
  avgLunchMinutes: number | null;
  totalBreakMinutes: number;
  totalLunchMinutes: number;
  breakCount: number;
  lunchCount: number;
}

interface BreakReportData {
  records: BreakRecord[];
  userSummaries: UserSummary[];
  defaults: { breakMinutes: number; lunchMinutes: number };
}

const STATION_LABELS: Record<string, string> = {
  mixing: "Mixing",
  building: "Building",
  dough_prep: "Dough Prep",
  dough_sheeting: "Dough Sheeting",
  ovens: "Ovens",
  wrapping: "Wrapping",
  packing: "Packing",
  main_prep: "Main Prep",
  prep_veg: "Veg Prep",
  prep_bases: "Bases & Sauces",
  prep_meat: "Meat Prep",
  mac_cheese_packs: "Mac Cheese Packs",
};

export function BreaksTab({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const { data, isLoading, isError } = useQuery<BreakReportData>({
    queryKey: ["reports-breaks", fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const r = await fetch(`${BASE}/api/reports/breaks?${params.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error(`Break report failed (${r.status})`);
      return (await r.json()) as BreakReportData;
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return <div className="text-center text-muted-foreground py-8">Failed to load report data</div>;
  }

  const totalBreaks = data.records.filter(r => r.breakType !== "lunch").length;
  const totalLunches = data.records.filter(r => r.breakType === "lunch").length;
  const avgBreak = totalBreaks > 0
    ? Math.round(data.records.filter(r => r.breakType !== "lunch").reduce((s, r) => s + r.durationMinutes, 0) / totalBreaks)
    : 0;
  const avgLunch = totalLunches > 0
    ? Math.round(data.records.filter(r => r.breakType === "lunch").reduce((s, r) => s + r.durationMinutes, 0) / totalLunches)
    : 0;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          icon={<Coffee className="w-5 h-5 text-amber-600" />}
          label="Total Breaks"
          value={String(totalBreaks)}
          sub={`Default: ${data.defaults.breakMinutes} min`}
        />
        <SummaryCard
          icon={<Utensils className="w-5 h-5 text-blue-600" />}
          label="Total Lunches"
          value={String(totalLunches)}
          sub={`Default: ${data.defaults.lunchMinutes} min`}
        />
        <SummaryCard
          icon={<Clock className="w-5 h-5 text-emerald-600" />}
          label="Avg Break"
          value={`${avgBreak} min`}
          sub={avgBreak > data.defaults.breakMinutes ? `${avgBreak - data.defaults.breakMinutes} min over` : "Within allowed"}
          highlight={avgBreak > data.defaults.breakMinutes ? "red" : "green"}
        />
        <SummaryCard
          icon={<Clock className="w-5 h-5 text-purple-600" />}
          label="Avg Lunch"
          value={`${avgLunch} min`}
          sub={avgLunch > data.defaults.lunchMinutes ? `${avgLunch - data.defaults.lunchMinutes} min over` : "Within allowed"}
          highlight={avgLunch > data.defaults.lunchMinutes ? "red" : "green"}
        />
      </div>

      {data.userSummaries.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Per-User Summary
          </h2>
          <div className="rounded-2xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium text-left">User</th>
                  <th className="px-4 py-3 font-medium text-center">Breaks</th>
                  <th className="px-4 py-3 font-medium text-center">Avg Break</th>
                  <th className="px-4 py-3 font-medium text-center">Lunches</th>
                  <th className="px-4 py-3 font-medium text-center">Avg Lunch</th>
                  <th className="px-4 py-3 font-medium text-center">Total Break Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.userSummaries.map(u => {
                  const totalMinutes = u.totalBreakMinutes + u.totalLunchMinutes;
                  const breakOver = u.avgBreakMinutes !== null && u.avgBreakMinutes > data.defaults.breakMinutes;
                  const lunchOver = u.avgLunchMinutes !== null && u.avgLunchMinutes > data.defaults.lunchMinutes;
                  return (
                    <tr key={u.userId} className="hover:bg-secondary/10 transition-colors">
                      <td className="px-4 py-3 font-medium">{u.userName}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{u.breakCount}</td>
                      <td className={cn("px-4 py-3 text-center tabular-nums font-medium", breakOver ? "text-red-600" : "text-emerald-600")}>
                        {u.avgBreakMinutes !== null ? `${u.avgBreakMinutes} min` : "—"}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">{u.lunchCount}</td>
                      <td className={cn("px-4 py-3 text-center tabular-nums font-medium", lunchOver ? "text-red-600" : "text-emerald-600")}>
                        {u.avgLunchMinutes !== null ? `${u.avgLunchMinutes} min` : "—"}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                        {totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m` : `${totalMinutes} min`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" /> Break Log
        </h2>
        {data.records.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
            <Coffee className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="font-medium">No break records found for this period</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium text-left">Date</th>
                  <th className="px-4 py-3 font-medium text-left">User</th>
                  <th className="px-4 py-3 font-medium text-left">Station</th>
                  <th className="px-4 py-3 font-medium text-left">Type</th>
                  <th className="px-4 py-3 font-medium text-center">Start</th>
                  <th className="px-4 py-3 font-medium text-center">End</th>
                  <th className="px-4 py-3 font-medium text-center">Duration</th>
                  <th className="px-4 py-3 font-medium text-center">Allowed</th>
                  <th className="px-4 py-3 font-medium text-center">+/-</th>
                  <th className="px-4 py-3 font-medium text-left">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.records.map(r => (
                  <tr key={r.id} className="hover:bg-secondary/10 transition-colors">
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {r.planDate ? format(new Date(r.planDate), "dd MMM") : format(new Date(r.startedAt), "dd MMM")}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{r.userName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{STATION_LABELS[r.stationType] ?? r.stationType}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                        r.breakType === "lunch"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      )}>
                        {r.breakType === "lunch" ? <Utensils className="w-3 h-3" /> : <Coffee className="w-3 h-3" />}
                        {r.breakType === "lunch" ? "Lunch" : "Break"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center tabular-nums text-xs">{format(new Date(r.startedAt), "HH:mm")}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums text-xs">{format(new Date(r.endedAt), "HH:mm")}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums font-medium">{r.durationMinutes} min</td>
                    <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">{r.allowedMinutes} min</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={cn(
                        "inline-flex items-center gap-0.5 text-xs font-semibold",
                        r.overUnder > 0
                          ? "text-red-600"
                          : r.overUnder < 0
                            ? "text-emerald-600"
                            : "text-muted-foreground"
                      )}>
                        {r.overUnder > 0 ? (
                          <><ArrowUp className="w-3 h-3" />+{r.overUnder}</>
                        ) : r.overUnder < 0 ? (
                          <><ArrowDown className="w-3 h-3" />{r.overUnder}</>
                        ) : (
                          <><MinusIcon className="w-3 h-3" />0</>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-sm min-w-[12rem]">
                      {r.note ? (
                        <span className="inline-flex items-start gap-1.5">
                          <StickyNote className="w-3.5 h-3.5 mt-0.5 text-amber-600 flex-shrink-0" />
                          <span className="whitespace-pre-wrap break-words">{r.note}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
