import { useState, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { format } from "date-fns";
import {
  Loader2, Coffee, Utensils, Clock, Users,
  ArrowUp, ArrowDown, Minus as MinusIcon,
  TrendingUp, Activity, Layers, Target, Timer,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

interface KpiOverview {
  totalBatches: number;
  totalActiveMinutes: number;
  overallBph: number;
  uniqueDays: number;
  avgBatchesPerDay: number;
}

interface StationSummary {
  station: string;
  label: string;
  totalBatches: number;
  avgBph: number;
  sessionCount: number;
  targetBph: number | null;
  minBph: number | null;
}

interface KpiUserSummary {
  userId: number;
  userName: string;
  totalBatches: number;
  avgBph: number;
  totalActiveMinutes: number;
  sessionCount: number;
  stations: string[];
}

interface DailySession {
  date: string;
  station: string;
  stationLabel: string;
  userId: number | null;
  userName: string;
  planId: number;
  planName: string;
  batchCount: number;
  activeMinutes: number;
  breakMinutes: number;
  bph: number;
  targetBph: number | null;
  minBph: number | null;
  status: "above" | "on-target" | "below" | "unknown";
  recipes: Array<{ name: string; count: number }>;
}

interface KpiReportData {
  overview: KpiOverview;
  stationSummaries: StationSummary[];
  userSummaries: KpiUserSummary[];
  dailySessions: DailySession[];
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

type TabId = "kpis" | "breaks";

export default function Reports() {
  const [activeTab, setActiveTab] = useState<TabId>("kpis");

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [fromDate, setFromDate] = useState(format(thirtyDaysAgo, "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(today, "yyyy-MM-dd"));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Production KPIs, break and lunch tracking analytics."
      />

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1 bg-secondary/30 rounded-xl p-1">
          <TabButton active={activeTab === "kpis"} onClick={() => setActiveTab("kpis")}>
            <TrendingUp className="w-4 h-4" /> Production KPIs
          </TabButton>
          <TabButton active={activeTab === "breaks"} onClick={() => setActiveTab("breaks")}>
            <Coffee className="w-4 h-4" /> Breaks & Lunches
          </TabButton>
        </div>
        <div className="flex items-center gap-2 ml-auto">
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

      {activeTab === "kpis" ? (
        <ProductionKpisTab fromDate={fromDate} toDate={toDate} />
      ) : (
        <BreaksTab fromDate={fromDate} toDate={toDate} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function ProductionKpisTab({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const [data, setData] = useState<KpiReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    fetch(`${BASE}/api/reports/production-kpis?${params.toString()}`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setData(null); setLoading(false); });
  }, [fromDate, toDate]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-center text-muted-foreground py-8">Failed to load production KPI data</div>;
  }

  const toggleDate = (date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const groupedByDate = new Map<string, DailySession[]>();
  for (const ds of data.dailySessions) {
    if (!groupedByDate.has(ds.date)) groupedByDate.set(ds.date, []);
    groupedByDate.get(ds.date)!.push(ds);
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard
          icon={<Layers className="w-5 h-5 text-blue-600" />}
          label="Total Batches"
          value={String(data.overview.totalBatches)}
          sub={`Over ${data.overview.uniqueDays} day${data.overview.uniqueDays !== 1 ? "s" : ""}`}
        />
        <SummaryCard
          icon={<Activity className="w-5 h-5 text-emerald-600" />}
          label="Overall BPH"
          value={String(data.overview.overallBph)}
          sub="Batches per hour"
        />
        <SummaryCard
          icon={<Target className="w-5 h-5 text-violet-600" />}
          label="Avg / Day"
          value={String(data.overview.avgBatchesPerDay)}
          sub="Batches per day"
        />
        <SummaryCard
          icon={<Timer className="w-5 h-5 text-amber-600" />}
          label="Active Time"
          value={data.overview.totalActiveMinutes >= 60
            ? `${Math.floor(data.overview.totalActiveMinutes / 60)}h ${data.overview.totalActiveMinutes % 60}m`
            : `${data.overview.totalActiveMinutes}m`}
          sub="Total productive time"
        />
        <SummaryCard
          icon={<Users className="w-5 h-5 text-rose-600" />}
          label="Stations Active"
          value={String(data.stationSummaries.length)}
          sub={`${data.userSummaries.length} user${data.userSummaries.length !== 1 ? "s" : ""}`}
        />
      </div>

      {data.stationSummaries.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" /> Station Performance
          </h2>
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium text-left">Station</th>
                  <th className="px-4 py-3 font-medium text-center">Total Batches</th>
                  <th className="px-4 py-3 font-medium text-center">Avg BPH</th>
                  <th className="px-4 py-3 font-medium text-center">Target BPH</th>
                  <th className="px-4 py-3 font-medium text-center">Min BPH</th>
                  <th className="px-4 py-3 font-medium text-center">Sessions</th>
                  <th className="px-4 py-3 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.stationSummaries.map(ss => {
                  const status = ss.targetBph !== null && ss.minBph !== null
                    ? ss.avgBph >= ss.targetBph ? "above"
                      : ss.avgBph >= ss.minBph ? "on-target"
                      : "below"
                    : "unknown";
                  return (
                    <tr key={ss.station} className="hover:bg-secondary/10 transition-colors">
                      <td className="px-4 py-3 font-medium">{ss.label}</td>
                      <td className="px-4 py-3 text-center tabular-nums font-semibold">{ss.totalBatches}</td>
                      <td className={cn("px-4 py-3 text-center tabular-nums font-bold", bphColor(status))}>
                        {ss.avgBph}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                        {ss.targetBph ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                        {ss.minBph ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">{ss.sessionCount}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.userSummaries.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> User Productivity
          </h2>
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium text-left">User</th>
                  <th className="px-4 py-3 font-medium text-center">Total Batches</th>
                  <th className="px-4 py-3 font-medium text-center">Avg BPH</th>
                  <th className="px-4 py-3 font-medium text-center">Active Time</th>
                  <th className="px-4 py-3 font-medium text-center">Sessions</th>
                  <th className="px-4 py-3 font-medium text-left">Stations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.userSummaries.map(us => (
                  <tr key={us.userId} className="hover:bg-secondary/10 transition-colors">
                    <td className="px-4 py-3 font-medium">{us.userName}</td>
                    <td className="px-4 py-3 text-center tabular-nums font-semibold">{us.totalBatches}</td>
                    <td className="px-4 py-3 text-center tabular-nums font-bold text-primary">{us.avgBph}</td>
                    <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                      {us.totalActiveMinutes >= 60
                        ? `${Math.floor(us.totalActiveMinutes / 60)}h ${us.totalActiveMinutes % 60}m`
                        : `${us.totalActiveMinutes}m`}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">{us.sessionCount}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{us.stations.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" /> Daily Detail
        </h2>
        {data.dailySessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="font-medium">No production data found for this period</p>
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from(groupedByDate.entries()).map(([date, sessions]) => {
              const isExpanded = expandedDates.has(date);
              const dayTotal = sessions.reduce((s, ds) => s + ds.batchCount, 0);
              const dayStations = new Set(sessions.map(s => s.stationLabel)).size;
              return (
                <div key={date} className="rounded-2xl border border-border bg-card overflow-hidden">
                  <button
                    onClick={() => toggleDate(date)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/10 transition-colors"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    }
                    <span className="font-semibold text-sm">{format(new Date(date + "T00:00:00"), "EEE dd MMM yyyy")}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {dayTotal} batch{dayTotal !== 1 ? "es" : ""} · {dayStations} station{dayStations !== 1 ? "s" : ""}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      {sessions.some(s => s.status === "below") && (
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                      )}
                      {sessions.some(s => s.status === "above") && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      )}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-secondary/20 text-muted-foreground text-xs">
                          <tr>
                            <th className="px-4 py-2 font-medium text-left">Station</th>
                            <th className="px-4 py-2 font-medium text-left">User</th>
                            <th className="px-4 py-2 font-medium text-left">Plan</th>
                            <th className="px-4 py-2 font-medium text-center">Batches</th>
                            <th className="px-4 py-2 font-medium text-center">Active</th>
                            <th className="px-4 py-2 font-medium text-center">Break</th>
                            <th className="px-4 py-2 font-medium text-center">BPH</th>
                            <th className="px-4 py-2 font-medium text-center">Target</th>
                            <th className="px-4 py-2 font-medium text-center">Status</th>
                            <th className="px-4 py-2 font-medium text-left">Recipes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {sessions.map((ds, i) => (
                            <tr key={i} className="hover:bg-secondary/5 transition-colors">
                              <td className="px-4 py-2 font-medium">{ds.stationLabel}</td>
                              <td className="px-4 py-2 text-muted-foreground">{ds.userName}</td>
                              <td className="px-4 py-2 text-muted-foreground text-xs truncate max-w-[120px]">{ds.planName}</td>
                              <td className="px-4 py-2 text-center tabular-nums font-semibold">{ds.batchCount}</td>
                              <td className="px-4 py-2 text-center tabular-nums text-muted-foreground">
                                {ds.activeMinutes >= 60
                                  ? `${Math.floor(ds.activeMinutes / 60)}h ${ds.activeMinutes % 60}m`
                                  : `${ds.activeMinutes}m`}
                              </td>
                              <td className="px-4 py-2 text-center tabular-nums text-muted-foreground">{ds.breakMinutes}m</td>
                              <td className={cn("px-4 py-2 text-center tabular-nums font-bold", bphColor(ds.status))}>
                                {ds.bph}
                              </td>
                              <td className="px-4 py-2 text-center tabular-nums text-muted-foreground text-xs">
                                {ds.targetBph ?? "—"}
                              </td>
                              <td className="px-4 py-2 text-center">
                                <StatusBadge status={ds.status} />
                              </td>
                              <td className="px-4 py-2 text-xs text-muted-foreground">
                                {ds.recipes.map(r => `${r.name} (${r.count})`).join(", ")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function bphColor(status: string) {
  if (status === "above") return "text-emerald-600";
  if (status === "on-target") return "text-amber-600";
  if (status === "below") return "text-red-600";
  return "text-foreground";
}

function StatusBadge({ status }: { status: string }) {
  if (status === "above") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        <ArrowUp className="w-3 h-3" /> Above
      </span>
    );
  }
  if (status === "on-target") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        <MinusIcon className="w-3 h-3" /> On Target
      </span>
    );
  }
  if (status === "below") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
        <ArrowDown className="w-3 h-3" /> Below
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-muted-foreground">
      — No Target
    </span>
  );
}

function BreaksTab({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const [data, setData] = useState<BreakReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    fetch(`${BASE}/api/reports/breaks?${params.toString()}`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setData(null); setLoading(false); });
  }, [fromDate, toDate]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
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
