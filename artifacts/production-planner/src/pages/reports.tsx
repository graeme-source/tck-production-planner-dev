import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { PageHeader } from "@/components/page-header";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, subWeeks, subMonths } from "date-fns";
import {
  Loader2, Coffee, Utensils, Clock, Users,
  ArrowUp, ArrowDown, Minus as MinusIcon,
  TrendingUp, TrendingDown, Activity, Layers, Target, Timer,
  ChevronDown, ChevronRight, Thermometer, ShieldCheck,
  Package, Zap, CalendarDays, Trophy, Snail, Hourglass,
  Lightbulb, AlertTriangle, CheckCircle, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";

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
  prep_bases: "Bases & Sauces",
  prep_meat: "Meat Prep",
};

interface PackingDayRow {
  date: string;
  count: number;
  firstFulfilledAt: string | null;
  lastFulfilledAt: string | null;
  windowMinutes: number | null;
  activeMinutes: number | null;
  idleMinutes: number | null;
  idleBreaks: number;
  ordersPerHour: number | null;
}

interface PackingSpeedData {
  totalOrders: number;
  totalDays: number;
  ordersPerHour: number;
  avgPerDay: number;
  busiestDay: { date: string; count: number } | null;
  fastestDay: { date: string; ordersPerHour: number } | null;
  slowestDay: { date: string; ordersPerHour: number } | null;
  totalIdleMinutes: number;
  totalActiveMinutes: number;
  dailyRows: PackingDayRow[];
  source?: string;
}

type TabId = "kpis" | "breaks" | "temperature" | "packing-speed" | "improvements" | "andon";

interface ImprovementRecord {
  id: number;
  title: string;
  description: string;
  station: string;
  type: "improvement" | "struggle";
  submittedByName: string | null;
  approvalTier: "minor" | "medium" | "major" | null;
  progressStatus: "submitted_for_review" | "acknowledged" | "approved" | "testing" | "complete" | "rejected";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AndonIssueRecord {
  id: number;
  category: "equipment" | "safety" | "production" | "product" | "other";
  severity: "yellow" | "red";
  description: string | null;
  station: string;
  reportedByName: string | null;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

// ── Date shortcut presets ──────────────────────────────────────────────────
const DATE_PRESETS = [
  { label: "Today", getRange: () => { const d = new Date(); return [format(d, "yyyy-MM-dd"), format(d, "yyyy-MM-dd")]; } },
  { label: "Yesterday", getRange: () => { const d = subDays(new Date(), 1); return [format(d, "yyyy-MM-dd"), format(d, "yyyy-MM-dd")]; } },
  { label: "This Week", getRange: () => { const now = new Date(); return [format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"), format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd")]; } },
  { label: "Last Week", getRange: () => { const lw = subWeeks(new Date(), 1); return [format(startOfWeek(lw, { weekStartsOn: 1 }), "yyyy-MM-dd"), format(endOfWeek(lw, { weekStartsOn: 1 }), "yyyy-MM-dd")]; } },
  { label: "This Month", getRange: () => { const now = new Date(); return [format(startOfMonth(now), "yyyy-MM-dd"), format(endOfMonth(now), "yyyy-MM-dd")]; } },
  { label: "Last Month", getRange: () => { const lm = subMonths(new Date(), 1); return [format(startOfMonth(lm), "yyyy-MM-dd"), format(endOfMonth(lm), "yyyy-MM-dd")]; } },
] as const;

function DateShortcutsDropdown({ onSelect }: { onSelect: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm bg-background hover:bg-secondary/50 transition-colors"
      >
        <CalendarDays className="w-4 h-4 text-muted-foreground" />
        <span className="text-muted-foreground">Quick Select</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-lg py-1 min-w-[150px]">
          {DATE_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => { const [f, t] = p.getRange(); onSelect(f, t); setOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-secondary/50 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const VALID_TABS: TabId[] = ["kpis", "breaks", "temperature", "packing-speed", "improvements", "andon"];

export default function Reports() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const queryTab = new URLSearchParams(search).get("tab") as TabId | null;
  const initialTab: TabId = queryTab && VALID_TABS.includes(queryTab) ? queryTab : "kpis";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const { state } = useAuth();
  const userRole = state.status === "authenticated" ? state.user.role : "viewer";

  function switchTab(tab: TabId) {
    setActiveTab(tab);
    const newSearch = tab === "kpis" ? "" : `?tab=${tab}`;
    navigate(`/reports${newSearch}`, { replace: true });
  }

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);

  const showDatePicker = activeTab !== "packing-speed" && activeTab !== "improvements" && activeTab !== "andon";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Production KPIs, break and lunch tracking analytics."
      />

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1 bg-secondary/30 rounded-xl p-1 flex-wrap">
          <TabButton active={activeTab === "kpis"} onClick={() => switchTab("kpis")}>
            <TrendingUp className="w-4 h-4" /> Production KPIs
          </TabButton>
          <TabButton active={activeTab === "breaks"} onClick={() => switchTab("breaks")}>
            <Coffee className="w-4 h-4" /> Breaks & Lunches
          </TabButton>
          <TabButton active={activeTab === "temperature"} onClick={() => switchTab("temperature")}>
            <Thermometer className="w-4 h-4" /> Temperature Log
          </TabButton>
          <TabButton active={activeTab === "packing-speed"} onClick={() => switchTab("packing-speed")}>
            <Zap className="w-4 h-4" /> Packing Speed
          </TabButton>
          <TabButton active={activeTab === "improvements"} onClick={() => switchTab("improvements")}>
            <Lightbulb className="w-4 h-4" /> Improvements & Struggles
          </TabButton>
          <TabButton active={activeTab === "andon"} onClick={() => switchTab("andon")}>
            <AlertTriangle className="w-4 h-4" /> Andon Log
          </TabButton>
        </div>
        {showDatePicker && (
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <DateShortcutsDropdown onSelect={(f, t) => { setFromDate(f); setToDate(t); }} />
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
        )}
      </div>

      {activeTab === "kpis" && <ProductionKpisTab fromDate={fromDate} toDate={toDate} />}
      {activeTab === "breaks" && <BreaksTab fromDate={fromDate} toDate={toDate} />}
      {activeTab === "temperature" && <TemperatureRecordsTab fromDate={fromDate} toDate={toDate} />}
      {activeTab === "packing-speed" && <PackingSpeedTab />}
      {activeTab === "improvements" && <ImprovementsTab userRole={userRole} currentUserName={state.status === "authenticated" ? state.user.name : null} />}
      {activeTab === "andon" && <AndonLogTab userRole={userRole} />}
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

interface TemperatureRecord {
  id: number;
  planId: number;
  recipeId: number;
  ingredientId: number;
  trayIndex: number;
  temperatureC: string;
  recordType: string;
  userId: number | null;
  userName: string | null;
  recordedAt: string;
  planName?: string;
  recipeName?: string;
  ingredientName?: string;
}

function TemperatureRecordsTab({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const [records, setRecords] = useState<TemperatureRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${BASE}/api/temperature-records?from=${fromDate}&to=${toDate}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : r.json().then((d: { error?: string }) => { throw new Error(d.error || "Failed to load"); }))
      .then((data: TemperatureRecord[]) => { setRecords(data); setLoading(false); })
      .catch((err: Error) => { setError(err.message); setLoading(false); });
  }, [fromDate, toDate]);

  const passed = records.filter(r => parseFloat(r.temperatureC) >= 75);
  const failed = records.filter(r => parseFloat(r.temperatureC) < 75);
  const avgTemp = records.length > 0
    ? (records.reduce((s, r) => s + parseFloat(r.temperatureC), 0) / records.length).toFixed(1)
    : "—";

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading temperature records…
    </div>
  );
  if (error) return (
    <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400 text-sm">{error}</div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard icon={<Thermometer className="w-4 h-4 text-blue-500" />} label="Total Readings" value={String(records.length)} />
        <SummaryCard icon={<ShieldCheck className="w-4 h-4 text-green-600" />} label="Above 75°C" value={String(passed.length)} sub={records.length ? `${Math.round((passed.length / records.length) * 100)}% pass rate` : undefined} highlight="green" />
        <SummaryCard icon={<Thermometer className="w-4 h-4 text-red-500" />} label="Below 75°C" value={String(failed.length)} sub={failed.length > 0 ? "Requires attention" : "None"} highlight={failed.length > 0 ? "red" : undefined} />
        <SummaryCard icon={<Activity className="w-4 h-4 text-amber-500" />} label="Average Temp" value={avgTemp === "—" ? "—" : `${avgTemp}°C`} />
      </div>

      {records.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground text-sm">
          No temperature records found for this date range.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/20">
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Recorded At</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Recipe</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Ingredient</th>
                  <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Tray</th>
                  <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Temp</th>
                  <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Recorded By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {records.map(rec => {
                  const temp = parseFloat(rec.temperatureC);
                  const safe = temp >= 75;
                  return (
                    <tr key={rec.id} className={cn("hover:bg-secondary/10 transition-colors", !safe && "bg-red-50/60 dark:bg-red-950/20")}>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground whitespace-nowrap">
                        {format(new Date(rec.recordedAt), "dd MMM yyyy, HH:mm")}
                      </td>
                      <td className="px-4 py-3 font-medium">{rec.recipeName ?? `Recipe #${rec.recipeId}`}</td>
                      <td className="px-4 py-3 text-muted-foreground">{rec.ingredientName ?? `Ingredient #${rec.ingredientId}`}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{rec.trayIndex + 1}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("font-bold tabular-nums", safe ? "text-green-700 dark:text-green-400" : "text-red-600")}>
                          {temp.toFixed(1)}°C
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {safe ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 rounded-full px-2 py-0.5">
                            <ShieldCheck className="w-3 h-3" /> Safe
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 dark:bg-red-900/30 rounded-full px-2 py-0.5">
                            <Thermometer className="w-3 h-3" /> Low
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{rec.userName ?? "Unknown"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Packing Speed Tab ──────────────────────────────────────────────────────
function PackingSpeedTab() {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const defaultFrom = format(startOfMonth(new Date()), "yyyy-MM-dd");

  // Today section — always fixed to today
  const [todayData, setTodayData] = useState<PackingSpeedData | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);
  const [todayError, setTodayError] = useState<string | null>(null);

  // Range section — user-controlled date picker
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(todayStr);
  const [rangeData, setRangeData] = useState<PackingSpeedData | null>(null);
  const [rangeLoading, setRangeLoading] = useState(true);
  const [rangeError, setRangeError] = useState<string | null>(null);

  useEffect(() => {
    setTodayLoading(true);
    setTodayError(null);
    fetch(`${BASE}/api/reports/packing-speed?from=${todayStr}&to=${todayStr}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : r.json().then((d: { error?: string }) => { throw new Error(d.error || "Failed"); }))
      .then((d: PackingSpeedData) => { setTodayData(d); setTodayLoading(false); })
      .catch((err: Error) => { setTodayError(err.message); setTodayLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayStr]);

  useEffect(() => {
    setRangeLoading(true);
    setRangeError(null);
    const params = new URLSearchParams({ from: fromDate, to: toDate });
    fetch(`${BASE}/api/reports/packing-speed?${params}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : r.json().then((d: { error?: string }) => { throw new Error(d.error || "Failed"); }))
      .then((d: PackingSpeedData) => { setRangeData(d); setRangeLoading(false); })
      .catch((err: Error) => { setRangeError(err.message); setRangeLoading(false); });
  }, [fromDate, toDate]);

  const fmtMins = (m: number | null) => {
    if (m == null || m === 0) return "—";
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };

  const todayRow = todayData?.dailyRows[0] ?? null;

  return (
    <div className="space-y-8">

      {/* ── TODAY: Fixed KPIs ──────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-base font-semibold">Today's Packing</h2>
          <span className="text-xs text-muted-foreground bg-secondary px-2.5 py-1 rounded-full font-medium">
            {format(new Date(), "EEEE d MMMM yyyy")}
          </span>
          {todayLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>

        {todayError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400 text-sm">{todayError}</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              icon={<Package className="w-4 h-4 text-blue-500" />}
              label="Orders Packed"
              value={todayData ? String(todayData.totalOrders) : "—"}
              sub={todayData?.totalOrders === 0 ? "None fulfilled yet today" : undefined}
            />
            <SummaryCard
              icon={<Zap className="w-4 h-4 text-amber-500" />}
              label="Packing Speed"
              value={todayData && todayData.ordersPerHour > 0 ? `${todayData.ordersPerHour}/hr` : "—"}
              sub="orders/hr · idle deducted"
            />
            <SummaryCard
              icon={<Timer className="w-4 h-4 text-emerald-500" />}
              label="Active Packing Time"
              value={todayData ? fmtMins(todayData.totalActiveMinutes) : "—"}
              sub={todayRow?.firstFulfilledAt ? `Started ${format(new Date(todayRow.firstFulfilledAt), "HH:mm")}` : undefined}
            />
            <SummaryCard
              icon={<Coffee className="w-4 h-4 text-orange-400" />}
              label="Idle / Breaks"
              value={todayData ? fmtMins(todayData.totalIdleMinutes) : "—"}
              sub={todayRow && todayRow.idleBreaks > 0 ? `${todayRow.idleBreaks} break${todayRow.idleBreaks !== 1 ? "s" : ""} detected` : "No idle gaps"}
            />
          </div>
        )}
      </section>

      {/* ── DIVIDER + DATE PICKER ──────────────────────────────────────────── */}
      <div className="border-t border-border pt-6">
        <div className="flex items-center gap-4 flex-wrap justify-between mb-6">
          <div>
            <h2 className="text-base font-semibold">Period Analysis</h2>
            <p className="text-xs text-muted-foreground mt-0.5">KPIs for the selected date range</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DateShortcutsDropdown onSelect={(f, t) => { setFromDate(f); setToDate(t); }} />
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
            {rangeLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {/* ── RANGE KPIs ──────────────────────────────────────────────────── */}
        {rangeError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400 text-sm">{rangeError}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
              <SummaryCard
                icon={<Package className="w-4 h-4 text-blue-500" />}
                label="Total Orders Packed"
                value={rangeData ? String(rangeData.totalOrders) : "—"}
                sub={rangeData ? `across ${rangeData.totalDays} day${rangeData.totalDays !== 1 ? "s" : ""}` : undefined}
              />
              <SummaryCard
                icon={<Zap className="w-4 h-4 text-amber-500" />}
                label="Avg Packing Speed"
                value={rangeData && rangeData.ordersPerHour > 0 ? `${rangeData.ordersPerHour}/hr` : "—"}
                sub="orders/hr · active time only"
              />
              <SummaryCard
                icon={<Activity className="w-4 h-4 text-violet-500" />}
                label="Avg Orders / Day"
                value={rangeData && rangeData.avgPerDay > 0 ? String(rangeData.avgPerDay) : "—"}
                sub={rangeData && rangeData.totalDays > 0 ? `over ${rangeData.totalDays} packing day${rangeData.totalDays !== 1 ? "s" : ""}` : undefined}
              />
              <SummaryCard
                icon={<Trophy className="w-4 h-4 text-amber-500" />}
                label="Fastest Day"
                value={rangeData?.fastestDay ? `${rangeData.fastestDay.ordersPerHour}/hr` : "—"}
                sub={rangeData?.fastestDay ? format(new Date(rangeData.fastestDay.date + "T00:00:00"), "EEE d MMM") : undefined}
                highlight="green"
              />
              <SummaryCard
                icon={<Snail className="w-4 h-4 text-muted-foreground" />}
                label="Slowest Day"
                value={rangeData?.slowestDay ? `${rangeData.slowestDay.ordersPerHour}/hr` : "—"}
                sub={rangeData?.slowestDay ? format(new Date(rangeData.slowestDay.date + "T00:00:00"), "EEE d MMM") : undefined}
              />
              <SummaryCard
                icon={<TrendingUp className="w-4 h-4 text-emerald-500" />}
                label="Most Orders in a Day"
                value={rangeData?.busiestDay ? String(rangeData.busiestDay.count) : "—"}
                sub={rangeData?.busiestDay ? format(new Date(rangeData.busiestDay.date + "T00:00:00"), "EEE d MMM") : undefined}
                highlight="green"
              />
              <SummaryCard
                icon={<Timer className="w-4 h-4 text-emerald-500" />}
                label="Total Active Time"
                value={rangeData ? fmtMins(rangeData.totalActiveMinutes) : "—"}
                sub="packing time · idle deducted"
              />
              <SummaryCard
                icon={<Hourglass className="w-4 h-4 text-orange-400" />}
                label="Total Idle Time"
                value={rangeData ? fmtMins(rangeData.totalIdleMinutes) : "—"}
                sub="gaps >5 min between fulfillments"
              />
            </div>

            {/* ── Daily Breakdown Table ─────────────────────────────────── */}
            {rangeData && rangeData.totalOrders === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground text-sm">
                No fulfilled orders found for this date range. Orders are counted when their status is set to "fulfilled".
              </div>
            ) : rangeData ? (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-secondary/10">
                  <h3 className="text-sm font-semibold text-foreground">Daily Breakdown</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Based on Shopify fulfilled orders — start/end times are from the first and last fulfillment of the day</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/20">
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Date</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Orders</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">First</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Last</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Window</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Active</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Idle</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Rate</th>
                        <th className="px-4 py-3 w-32"><span className="sr-only">Bar</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rangeData.dailyRows.map(row => {
                        const maxCount = Math.max(...rangeData.dailyRows.map(r => r.count), 1);
                        const pct = Math.round((row.count / maxCount) * 100);
                        const isFastest = rangeData.fastestDay?.date === row.date;
                        const isBusiest = rangeData.busiestDay?.date === row.date;
                        return (
                          <tr key={row.date} className="hover:bg-secondary/10 transition-colors">
                            <td className="px-4 py-3 font-medium whitespace-nowrap">
                              {format(new Date(row.date + "T00:00:00"), "EEE dd MMM yyyy")}
                              {isFastest && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400 font-semibold">⚡ fastest</span>}
                              {isBusiest && !isFastest && <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">★ busiest</span>}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums font-semibold">
                              {row.count}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums text-muted-foreground whitespace-nowrap">
                              {row.firstFulfilledAt ? format(new Date(row.firstFulfilledAt), "HH:mm") : "—"}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums text-muted-foreground whitespace-nowrap">
                              {row.lastFulfilledAt ? format(new Date(row.lastFulfilledAt), "HH:mm") : "—"}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                              {fmtMins(row.windowMinutes)}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                              {fmtMins(row.activeMinutes)}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                              {row.idleMinutes && row.idleMinutes > 0 ? (
                                <span className="text-amber-600 dark:text-amber-400" title={`${row.idleBreaks} break${row.idleBreaks !== 1 ? "s" : ""} detected`}>
                                  {fmtMins(row.idleMinutes)}
                                  <span className="text-xs ml-1 opacity-70">({row.idleBreaks})</span>
                                </span>
                              ) : "—"}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums font-medium">
                              {row.ordersPerHour != null ? `${row.ordersPerHour}/hr` : "—"}
                            </td>
                            <td className="px-4 py-3">
                              <div className="w-full bg-secondary/40 rounded-full h-2">
                                <div
                                  className="bg-blue-500 h-2 rounded-full transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        * Data sourced from Shopify fulfilled orders. Rate is based on active packing time — gaps longer than 5 minutes between fulfillments are automatically detected and deducted as idle time. The "Idle" column shows total idle time with the number of breaks in brackets. Days with only one fulfillment show "—" for rate.
      </p>
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

const STATION_LABELS_REPORT: Record<string, string> = {
  dough_prep: "Dough Prep",
  dough_sheeting: "Dough Sheeting",
  prep: "Prep",
  main_prep: "Main Prep",
  prep_bases: "Bases & Sauces",
  prep_meat: "Raw Meat Prep",
  mixing: "Mixing & Cooking",
  building_1: "Building Table 1",
  building_2: "Building Table 2",
  ovens: "Ovens",
  wrapping: "Wrapping",
  packing: "Packing",
  general: "General / Other",
};

const IMPROVEMENT_PROGRESS_OPTIONS = [
  { value: "submitted_for_review", label: "Submitted for Review" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "approved", label: "Approved" },
  { value: "testing", label: "Testing" },
  { value: "complete", label: "Complete" },
  { value: "rejected", label: "Rejected" },
];

function statusRowClass(status: string) {
  if (status === "submitted_for_review") return "bg-yellow-50/60 dark:bg-yellow-900/10";
  if (status === "acknowledged") return "bg-violet-50/60 dark:bg-violet-900/10";
  if (status === "approved") return "bg-green-50/60 dark:bg-green-900/10";
  if (status === "testing") return "bg-blue-50/60 dark:bg-blue-900/10";
  if (status === "complete") return "bg-emerald-50/60 dark:bg-emerald-900/10";
  if (status === "rejected") return "bg-red-50/60 dark:bg-red-900/10";
  return "";
}

function statusBadgeClass(status: string) {
  if (status === "submitted_for_review") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
  if (status === "acknowledged") return "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400";
  if (status === "approved") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (status === "testing") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  if (status === "complete") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 font-semibold";
  if (status === "rejected") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  return "bg-secondary text-muted-foreground";
}

function statusSelectClass(status: string) {
  if (status === "submitted_for_review") return "border-yellow-300 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-700";
  if (status === "acknowledged") return "border-violet-300 bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-700";
  if (status === "approved") return "border-green-300 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 dark:border-green-700";
  if (status === "testing") return "border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700";
  if (status === "complete") return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-700";
  if (status === "rejected") return "border-red-300 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-700";
  return "border-border bg-background";
}

const IMPROVEMENT_TIER_OPTIONS = [
  { value: "", label: "— None —" },
  { value: "minor", label: "Minor" },
  { value: "medium", label: "Medium" },
  { value: "major", label: "Major" },
];

function ImprovementsTab({ userRole, currentUserName }: { userRole: string; currentUserName: string | null }) {
  const [improvements, setImprovements] = useState<ImprovementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState<Record<number, string>>({});

  // Filters
  const [viewTab, setViewTab] = useState<"all" | "mine">("all");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterStation, setFilterStation] = useState("");
  const [filterTier, setFilterTier] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterType, setFilterType] = useState("");

  const isManager = userRole === "admin" || userRole === "manager";

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/improvements`, { credentials: "include" });
      if (res.ok) setImprovements(await res.json());
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function updateField(id: number, field: string, value: string) {
    setUpdating(id);
    try {
      await fetch(`${BASE}/api/improvements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ [field]: value || null }),
      });
      await load();
    } catch {}
    setUpdating(null);
  }

  async function saveNotes(id: number) {
    await updateField(id, "notes", editNotes[id] ?? "");
  }

  const isAdmin = userRole === "admin";

  async function deleteEntry(id: number) {
    if (!confirm("Are you sure you want to delete this entry?")) return;
    try {
      const res = await fetch(`${BASE}/api/improvements/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
      setImprovements(prev => prev.filter(i => i.id !== id));
    } catch {
      alert("Failed to delete entry");
    }
  }

  const filtered = improvements.filter(imp => {
    if (viewTab === "mine" && imp.submittedByName !== currentUserName) return false;
    if (filterStatus && imp.progressStatus !== filterStatus) return false;
    if (filterStation && imp.station !== filterStation) return false;
    if (filterTier && (imp.approvalTier ?? "") !== filterTier) return false;
    if (filterType && (imp.type ?? "improvement") !== filterType) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      if (!imp.title.toLowerCase().includes(q) && !imp.description.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {/* Tab + filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* All / My Improvements tabs */}
        <div className="flex rounded-xl border border-border overflow-hidden text-sm">
          <button
            onClick={() => setViewTab("all")}
            className={cn("px-4 py-2 font-medium transition-colors", viewTab === "all" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground")}
          >
            All Entries
          </button>
          <button
            onClick={() => setViewTab("mine")}
            className={cn("px-4 py-2 font-medium transition-colors border-l border-border", viewTab === "mine" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground")}
          >
            My Entries
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search title / description…"
          value={filterSearch}
          onChange={e => setFilterSearch(e.target.value)}
          className="px-3 py-2 border border-border rounded-xl text-sm bg-background focus-ring w-48"
        />

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-border rounded-xl text-sm bg-background focus-ring"
        >
          <option value="">All statuses</option>
          {IMPROVEMENT_PROGRESS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Station filter */}
        <select
          value={filterStation}
          onChange={e => setFilterStation(e.target.value)}
          className="px-3 py-2 border border-border rounded-xl text-sm bg-background focus-ring"
        >
          <option value="">All stations</option>
          {Object.entries(STATION_LABELS_REPORT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {/* Tier filter */}
        <select
          value={filterTier}
          onChange={e => setFilterTier(e.target.value)}
          className="px-3 py-2 border border-border rounded-xl text-sm bg-background focus-ring"
        >
          <option value="">All tiers</option>
          {IMPROVEMENT_TIER_OPTIONS.filter(o => o.value).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Type filter */}
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 border border-border rounded-xl text-sm bg-background focus-ring"
        >
          <option value="">All types</option>
          <option value="improvement">Improvement</option>
          <option value="struggle">Struggle</option>
        </select>

        {(filterSearch || filterStatus || filterStation || filterTier || filterType) && (
          <button
            onClick={() => { setFilterSearch(""); setFilterStatus(""); setFilterStation(""); setFilterTier(""); setFilterType(""); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Lightbulb className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-muted-foreground">
            {improvements.length === 0 ? "No improvement submissions yet" : "No results match your filters"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {improvements.length === 0
              ? "Team members can submit ideas from the Record button on any page."
              : "Try adjusting or clearing your filters."}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-muted-foreground text-xs">
              <tr>
                <th className="px-4 py-3 font-medium text-left">Title</th>
                <th className="px-4 py-3 font-medium text-center">Type</th>
                <th className="px-4 py-3 font-medium text-left">Station</th>
                <th className="px-4 py-3 font-medium text-left">Submitted by</th>
                <th className="px-4 py-3 font-medium text-left">Date</th>
                <th className="px-4 py-3 font-medium text-center">Tier</th>
                <th className="px-4 py-3 font-medium text-center">Status</th>
                <th className="px-4 py-3 font-medium text-left">Notes</th>
                {isAdmin && <th className="px-4 py-3 font-medium text-center w-16"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map(imp => (
                <tr key={imp.id} className={cn("transition-colors align-top", statusRowClass(imp.progressStatus))}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{imp.title}</p>
                    {imp.description && <p className="text-xs text-muted-foreground mt-0.5 max-w-xs">{imp.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-xs font-medium",
                      (imp.type ?? "improvement") === "struggle"
                        ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    )}>
                      {(imp.type ?? "improvement") === "struggle" ? "Struggle" : "Improvement"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {STATION_LABELS_REPORT[imp.station] ?? imp.station}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{imp.submittedByName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {imp.createdAt ? format(new Date(imp.createdAt), "d MMM yyyy") : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isManager ? (
                      <select
                        value={imp.approvalTier ?? ""}
                        onChange={e => updateField(imp.id, "approvalTier", e.target.value)}
                        disabled={updating === imp.id}
                        className="px-2 py-1 border border-border rounded-lg text-xs bg-background disabled:opacity-50"
                      >
                        {IMPROVEMENT_TIER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <span className="text-muted-foreground capitalize">{imp.approvalTier ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isManager ? (
                      <select
                        value={imp.progressStatus}
                        onChange={e => updateField(imp.id, "progressStatus", e.target.value)}
                        disabled={updating === imp.id}
                        className={cn("px-2 py-1 border rounded-lg text-xs disabled:opacity-50", statusSelectClass(imp.progressStatus))}
                      >
                        {IMPROVEMENT_PROGRESS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <span className={cn("px-2 py-1 rounded-full text-xs", statusBadgeClass(imp.progressStatus))}>
                        {IMPROVEMENT_PROGRESS_OPTIONS.find(o => o.value === imp.progressStatus)?.label ?? imp.progressStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isManager ? (
                      <div className="flex items-start gap-2">
                        <textarea
                          value={editNotes[imp.id] !== undefined ? editNotes[imp.id] : (imp.notes ?? "")}
                          onChange={e => setEditNotes(prev => ({ ...prev, [imp.id]: e.target.value }))}
                          rows={2}
                          className="w-full min-w-[180px] px-2 py-1 border border-border rounded-lg text-xs bg-background resize-none"
                          placeholder="Add notes..."
                        />
                        {editNotes[imp.id] !== undefined && editNotes[imp.id] !== (imp.notes ?? "") && (
                          <button
                            onClick={() => saveNotes(imp.id)}
                            disabled={updating === imp.id}
                            className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
                          >
                            Save
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{imp.notes ?? "—"}</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => deleteEntry(imp.id)}
                        className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs px-2 py-1 rounded-lg border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const ANDON_CATEGORY_LABELS: Record<string, string> = {
  equipment: "Equipment",
  safety: "Safety",
  production: "Production",
  product: "Product",
  other: "Other",
};

function AndonLogTab({ userRole }: { userRole: string }) {
  const [issues, setIssues] = useState<AndonIssueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<number | null>(null);
  const [stationFilter, setStationFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");

  const isManager = userRole === "admin" || userRole === "manager";

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (stationFilter) params.set("station", stationFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      if (severityFilter) params.set("severity", severityFilter);
      const res = await fetch(`${BASE}/api/andon?${params.toString()}`, { credentials: "include" });
      if (res.ok) setIssues(await res.json());
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [stationFilter, categoryFilter, severityFilter]);

  async function acknowledge(id: number) {
    setActioningId(id);
    try {
      await fetch(`${BASE}/api/andon/${id}/acknowledge`, { method: "PATCH", credentials: "include" });
      await load();
    } catch {}
    setActioningId(null);
  }

  async function resolve(id: number) {
    setActioningId(id);
    try {
      await fetch(`${BASE}/api/andon/${id}/resolve`, { method: "PATCH", credentials: "include" });
      await load();
    } catch {}
    setActioningId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Filter:</span>
        </div>
        <select
          value={stationFilter}
          onChange={e => setStationFilter(e.target.value)}
          className="px-3 py-1.5 border border-border rounded-lg text-sm bg-background"
        >
          <option value="">All Stations</option>
          {Object.entries(STATION_LABELS_REPORT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-1.5 border border-border rounded-lg text-sm bg-background"
        >
          <option value="">All Categories</option>
          {Object.entries(ANDON_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value)}
          className="px-3 py-1.5 border border-border rounded-lg text-sm bg-background"
        >
          <option value="">All Severities</option>
          <option value="yellow">Yellow (Minor)</option>
          <option value="red">Red (Serious)</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : issues.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-muted-foreground">No Andon issues found</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-muted-foreground text-xs">
              <tr>
                <th className="px-4 py-3 font-medium text-left">Severity</th>
                <th className="px-4 py-3 font-medium text-left">Category</th>
                <th className="px-4 py-3 font-medium text-left">Station</th>
                <th className="px-4 py-3 font-medium text-left">Description</th>
                <th className="px-4 py-3 font-medium text-left">Reported by</th>
                <th className="px-4 py-3 font-medium text-left">Submitted</th>
                <th className="px-4 py-3 font-medium text-left">Acknowledged</th>
                <th className="px-4 py-3 font-medium text-left">Resolved</th>
                {isManager && <th className="px-4 py-3 font-medium text-center">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {issues.map(issue => (
                <tr key={issue.id} className="hover:bg-secondary/10 transition-colors align-top">
                  <td className="px-4 py-3">
                    <span className={cn(
                      "flex items-center gap-1.5 text-xs font-bold",
                      issue.severity === "red" ? "text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400"
                    )}>
                      <span className={cn("w-2 h-2 rounded-full", issue.severity === "red" ? "bg-red-500" : "bg-yellow-400")} />
                      {issue.severity === "red" ? "Serious" : "Minor"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">
                    {ANDON_CATEGORY_LABELS[issue.category] ?? issue.category}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {STATION_LABELS_REPORT[issue.station] ?? issue.station}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                    {issue.description ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{issue.reportedByName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                    {issue.createdAt ? format(new Date(issue.createdAt), "d MMM HH:mm") : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {issue.acknowledgedAt ? (
                      <div>
                        <p className="text-emerald-600 dark:text-emerald-400 font-medium">Acknowledged</p>
                        <p className="text-muted-foreground">{issue.acknowledgedByName ?? ""}</p>
                        <p className="text-muted-foreground">{format(new Date(issue.acknowledgedAt), "d MMM HH:mm")}</p>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {issue.resolvedAt ? (
                      <div>
                        <p className="text-emerald-600 dark:text-emerald-400 font-medium">Resolved</p>
                        <p className="text-muted-foreground">{issue.resolvedByName ?? ""}</p>
                        <p className="text-muted-foreground">{format(new Date(issue.resolvedAt), "d MMM HH:mm")}</p>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Open</span>
                    )}
                  </td>
                  {isManager && (
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col gap-1.5 items-center">
                        {!issue.acknowledgedAt && (
                          <button
                            onClick={() => acknowledge(issue.id)}
                            disabled={actioningId === issue.id}
                            className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-border rounded-lg hover:bg-secondary transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            <CheckCircle className="w-3 h-3" />
                            {actioningId === issue.id ? "..." : "Acknowledge"}
                          </button>
                        )}
                        {!issue.resolvedAt && (
                          <button
                            onClick={() => resolve(issue.id)}
                            disabled={actioningId === issue.id}
                            className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-emerald-500 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            <CheckCircle className="w-3 h-3" />
                            {actioningId === issue.id ? "..." : "Resolve"}
                          </button>
                        )}
                        {issue.resolvedAt && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Resolved</span>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
