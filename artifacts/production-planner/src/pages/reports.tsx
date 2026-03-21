import { useState, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { format } from "date-fns";
import {
  Loader2, Coffee, Utensils, Clock, Users,
  ArrowUp, ArrowDown, Minus as MinusIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BreakRecord {
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
  prep_bases: "Bases Prep",
  prep_meat: "Meat Prep",
};

export default function Reports() {
  const [data, setData] = useState<BreakReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [fromDate, setFromDate] = useState(format(thirtyDaysAgo, "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(today, "yyyy-MM-dd"));

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    fetch(`/api/reports/breaks?${params.toString()}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fromDate, toDate]);

  const totalBreaks = data?.records.filter(r => r.breakType !== "lunch").length ?? 0;
  const totalLunches = data?.records.filter(r => r.breakType === "lunch").length ?? 0;
  const avgBreak = totalBreaks > 0
    ? Math.round(data!.records.filter(r => r.breakType !== "lunch").reduce((s, r) => s + r.durationMinutes, 0) / totalBreaks)
    : 0;
  const avgLunch = totalLunches > 0
    ? Math.round(data!.records.filter(r => r.breakType === "lunch").reduce((s, r) => s + r.durationMinutes, 0) / totalLunches)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Break and lunch tracking analytics across all stations."
      />

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-background"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">To</label>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-background"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : data ? (
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
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
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
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="text-center text-muted-foreground py-8">Failed to load report data</div>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, sub, highlight }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  highlight?: "red" | "green";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-muted-foreground font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && (
        <p className={cn(
          "text-xs mt-1",
          highlight === "red" ? "text-red-600" : highlight === "green" ? "text-emerald-600" : "text-muted-foreground"
        )}>
          {sub}
        </p>
      )}
    </div>
  );
}
