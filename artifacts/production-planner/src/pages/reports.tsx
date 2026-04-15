import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearch, useLocation } from "wouter";
import { toast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, subWeeks, subMonths } from "date-fns";
import {
  Loader2, Coffee, Utensils, Clock, Users,
  ArrowUp, ArrowDown, Minus as MinusIcon,
  TrendingUp, TrendingDown, Activity, Layers, Target, Timer,
  ChevronDown, ChevronUp, ChevronRight, Thermometer, ShieldCheck,
  Package, Zap, CalendarDays, Trophy, Snail, Hourglass,
  Lightbulb, AlertTriangle, CheckCircle, Filter, Play, Square,
  MessageSquare, Send, ClipboardCheck, FileText, Eye, EyeOff,
  Droplets, UserCog,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

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
  wallClockMinutes: number;
  uniqueDays: number;
  avgBatchesPerDay: number;
  productionStartTime: string | null;
  productionFinishTime: string | null;
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

// Packing-speed is now a subsection inside the Production KPIs view, so it's
// no longer a top-level tab. The URL ?tab=packing-speed redirects to ?tab=kpis
// for backward compat.
type TabId = "kpis" | "breaks" | "temperature" | "haccp" | "improvements" | "issues" | "leftover-filling" | "employees";

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
  reportContext: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ImprovementComment {
  id: number;
  improvementId: number;
  userId: number | null;
  userName: string | null;
  comment: string;
  createdAt: string;
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
  { label: "Last 6 Months", getRange: () => { const now = new Date(); return [format(subMonths(now, 6), "yyyy-MM-dd"), format(now, "yyyy-MM-dd")]; } },
  { label: "Last 12 Months", getRange: () => { const now = new Date(); return [format(subMonths(now, 12), "yyyy-MM-dd"), format(now, "yyyy-MM-dd")]; } },
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

const VALID_TABS: TabId[] = ["kpis", "breaks", "temperature", "haccp", "improvements", "issues", "leftover-filling", "employees"];

interface ReportsNavItem {
  id: TabId;
  label: string;
  icon: typeof TrendingUp;
}

const REPORTS_NAV_ITEMS: ReportsNavItem[] = [
  { id: "kpis", label: "Production KPIs", icon: TrendingUp },
  { id: "breaks", label: "Breaks & Lunches", icon: Coffee },
  { id: "temperature", label: "Temperature Log", icon: Thermometer },
  { id: "haccp", label: "HACCP", icon: ShieldCheck },
  { id: "improvements", label: "Improvements & Struggles", icon: Lightbulb },
  { id: "issues", label: "Issue Log", icon: AlertTriangle },
  { id: "leftover-filling", label: "Leftover Filling", icon: Droplets },
  { id: "employees", label: "Employee Records", icon: UserCog },
];

// Tabs only visible to admins (not managers).
const ADMIN_ONLY_TABS: TabId[] = ["employees"];

export default function Reports() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { state } = useAuth();
  const userRole = state.status === "authenticated" ? state.user.role : "viewer";
  const isManagerOrAdmin = userRole === "admin" || userRole === "manager";

  // Viewers only see the Issue Log tab; managers see everything except admin-only tabs; admins see everything.
  const isAdmin = userRole === "admin";
  const visibleTabs = isManagerOrAdmin
    ? (isAdmin ? REPORTS_NAV_ITEMS : REPORTS_NAV_ITEMS.filter(item => !ADMIN_ONLY_TABS.includes(item.id)))
    : REPORTS_NAV_ITEMS.filter(item => item.id === "issues");
  const allowedTabIds = visibleTabs.map(t => t.id);

  const rawTab = new URLSearchParams(search).get("tab");
  const issueIdParam = new URLSearchParams(search).get("issueId");
  // Backward compat: legacy "andon" tab id redirects to "issues", and
  // "packing-speed" redirects to "kpis" since it's now a subsection there.
  const normalisedTab =
    rawTab === "andon" ? "issues" : rawTab === "packing-speed" ? "kpis" : rawTab;
  const queryTab = normalisedTab as TabId | null;
  const initialTab: TabId = queryTab && allowedTabIds.includes(queryTab) ? queryTab : allowedTabIds[0];
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  function switchTab(tab: TabId) {
    setActiveTab(tab);
    const newSearch = tab === "kpis" ? "" : `?tab=${tab}`;
    navigate(`/reports${newSearch}`, { replace: true });
  }

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);

  const showDatePicker = activeTab !== "improvements" && activeTab !== "issues";

  // Default range for employees tab: last 30 days (only applied once when tab first opened).
  const [employeesRangeInit, setEmployeesRangeInit] = useState(false);
  useEffect(() => {
    if (activeTab === "employees" && !employeesRangeInit) {
      const today = new Date();
      const thirtyAgo = new Date();
      thirtyAgo.setDate(today.getDate() - 29);
      setFromDate(format(thirtyAgo, "yyyy-MM-dd"));
      setToDate(format(today, "yyyy-MM-dd"));
      setEmployeesRangeInit(true);
    }
  }, [activeTab, employeesRangeInit]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={isManagerOrAdmin ? "Analytics" : "Issue Log"}
        description={isManagerOrAdmin ? "Production KPIs, break and lunch tracking analytics." : "View and respond to reported issues."}
      />

      <div className="flex gap-6 items-start">
        {/* Left nav — only show when more than one tab */}
        {visibleTabs.length > 1 && (
          <nav className="w-52 flex-shrink-0 sticky top-6 hidden md:block">
            <ul className="space-y-1">
              {visibleTabs.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => switchTab(item.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {/* Mobile: horizontal scroll of the same nav, shown above the content */}
        {visibleTabs.length > 1 && (
          <nav className="md:hidden w-full overflow-x-auto pb-2 -mb-2">
            <ul className="flex gap-1 min-w-max">
              {visibleTabs.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => switchTab(item.id)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {/* Right content panel */}
        <div className="flex-1 min-w-0 space-y-4">
          {showDatePicker && (
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
            </div>
          )}

          {activeTab === "kpis" && <ProductionKpisTab fromDate={fromDate} toDate={toDate} />}
          {activeTab === "breaks" && <BreaksTab fromDate={fromDate} toDate={toDate} />}
          {activeTab === "temperature" && <TemperatureRecordsTab fromDate={fromDate} toDate={toDate} />}
          {activeTab === "haccp" && <HaccpTab fromDate={fromDate} toDate={toDate} />}
          {activeTab === "improvements" && <ImprovementsTab userRole={userRole} currentUserName={state.status === "authenticated" ? state.user.name : null} />}
          {activeTab === "issues" && <AndonLogTab userRole={userRole} initialIssueId={issueIdParam ? parseInt(issueIdParam, 10) : undefined} />}
          {activeTab === "leftover-filling" && <LeftoverFillingTab fromDate={fromDate} toDate={toDate} />}
          {activeTab === "employees" && isAdmin && <EmployeesTab fromDate={fromDate} toDate={toDate} />}
        </div>
      </div>
    </div>
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
      .catch((err) => { console.warn("[Reports] KPI fetch failed:", err); toast({ title: "Failed to load KPIs", variant: "destructive" }); setData(null); setLoading(false); });
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
          icon={<Play className="w-5 h-5 text-emerald-600" />}
          label="Start Time"
          value={data.overview.productionStartTime ? format(new Date(data.overview.productionStartTime), "HH:mm") : "—"}
          sub={data.overview.productionStartTime ? format(new Date(data.overview.productionStartTime), "d MMM yyyy") : "No data"}
        />
        <SummaryCard
          icon={<Square className="w-5 h-5 text-red-500" />}
          label="Finish Time"
          value={data.overview.productionFinishTime ? format(new Date(data.overview.productionFinishTime), "HH:mm") : "—"}
          sub={data.overview.wallClockMinutes > 0
            ? `${Math.floor(data.overview.wallClockMinutes / 60)}h ${data.overview.wallClockMinutes % 60}m wall clock`
            : "No data"}
        />
        <SummaryCard
          icon={<Layers className="w-5 h-5 text-blue-600" />}
          label="Total Batches"
          value={String(data.overview.totalBatches)}
          sub="Both builders combined"
        />
        <SummaryCard
          icon={<Activity className="w-5 h-5 text-violet-600" />}
          label="Batches / Hour"
          value={String(data.overview.overallBph)}
          sub="Both building tables added"
        />
        <SummaryCard
          icon={<Timer className="w-5 h-5 text-amber-600" />}
          label="Active Time"
          value={data.overview.totalActiveMinutes >= 60
            ? `${Math.floor(data.overview.totalActiveMinutes / 60)}h ${data.overview.totalActiveMinutes % 60}m`
            : `${data.overview.totalActiveMinutes}m`}
          sub="Start to finish minus breaks"
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

      {/* Packing speed — previously a separate tab, now a section inside
          Production KPIs since packing throughput is a production metric.
          Has its own "today" + custom date range controls because its
          reporting window is typically wider than the KPI date range. */}
      <div className="pt-8 border-t border-border">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-5 h-5 text-amber-500" />
          <h2 className="text-lg font-bold">Packing Speed</h2>
        </div>
        <PackingSpeedTab />
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
      .catch((err) => { console.warn("[Reports] Breaks fetch failed:", err); toast({ title: "Failed to load break data", variant: "destructive" }); setData(null); setLoading(false); });
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

// ── HACCP Tab ──────────────────────────────────────────────────────────────
// Unified reporting view for EHO-relevant records: checklist completions
// (opening/cleaning/closing checks) and cooked-core temperature readings.
// Filterable by date range, station, user, and record kind. Intended as the
// single place auditors or managers can pull evidence of daily food-safety
// procedures.

interface HaccpChecklistRow {
  id: number;
  kind: "template" | "oneoff";
  templateId: number | null;
  planId: number;
  stationType: string;
  category: "opening" | "cleaning" | "closing";
  title: string;
  description: string | null;
  completedBy: number | null;
  completedByName: string | null;
  completedAt: string;
  notes: string | null;
}

interface HaccpMissingRow {
  id: string; // "tpl-{templateId}-plan-{planId}" or "oneoff-{id}"
  kind: "template-missing" | "oneoff-missing";
  templateId: number | null;
  planId: number;
  stationType: string;
  category: "opening" | "cleaning" | "closing";
  title: string;
  description: string | null;
  planDate: string;
  missing: true;
}

interface UserLite {
  id: number;
  name: string;
  email?: string;
  role?: string;
  isActive?: boolean;
}

const HACCP_CATEGORY_META: Record<HaccpChecklistRow["category"], { label: string; color: string; bg: string }> = {
  opening: { label: "Opening", color: "text-amber-700 dark:text-amber-300", bg: "bg-amber-100 dark:bg-amber-900/30" },
  cleaning: { label: "Cleaning", color: "text-blue-700 dark:text-blue-300", bg: "bg-blue-100 dark:bg-blue-900/30" },
  closing: { label: "Closing", color: "text-indigo-700 dark:text-indigo-300", bg: "bg-indigo-100 dark:bg-indigo-900/30" },
};

function HaccpTab({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const [checklists, setChecklists] = useState<HaccpChecklistRow[]>([]);
  const [missing, setMissing] = useState<HaccpMissingRow[]>([]);
  const [temps, setTemps] = useState<TemperatureRecord[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [stationFilter, setStationFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  // "all" = completed + outstanding + temperatures
  // "outstanding" = only expected-but-not-completed checklist items
  const [kindFilter, setKindFilter] = useState<"all" | "checklists" | "outstanding" | "temperatures">("all");
  const [categoryFilter, setCategoryFilter] = useState<"" | HaccpChecklistRow["category"]>("");

  // Collapsible sections — default both the completed and outstanding
  // sections to collapsed so the page is glanceable and the user opens the
  // one they care about.
  const [outstandingOpen, setOutstandingOpen] = useState(true);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [tempsOpen, setTempsOpen] = useState(false);

  // Load users once (for filter dropdown)
  useEffect(() => {
    fetch(`${BASE}/api/users`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((rows: UserLite[]) => setUsers(rows))
      .catch(() => { /* ignore */ });
  }, []);

  // Reload data when date range or server-side filters change. Station/user
  // filters are passed as query params so the backend does the heavy lifting.
  // We always pull the "missing" set too so the Outstanding filter can flip
  // on without another round-trip and so the summary card stays accurate.
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from: fromDate, to: toDate });
    if (stationFilter) params.set("stationType", stationFilter);
    if (userFilter) params.set("userId", userFilter);

    const checklistUrl = `${BASE}/api/checklists/completions?${params.toString()}`;
    const tempParams = new URLSearchParams({ from: fromDate, to: toDate });
    const tempUrl = `${BASE}/api/temperature-records?${tempParams.toString()}`;

    // The /missing endpoint does not take userId (un-done items have no
    // user), but it does honour stationType.
    const missingParams = new URLSearchParams({ from: fromDate, to: toDate });
    if (stationFilter) missingParams.set("stationType", stationFilter);
    const missingUrl = `${BASE}/api/checklists/missing?${missingParams.toString()}`;

    Promise.all([
      fetch(checklistUrl, { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch(tempUrl, { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch(missingUrl, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ])
      .then(([c, t, m]: [HaccpChecklistRow[], TemperatureRecord[], HaccpMissingRow[]]) => {
        setChecklists(c);
        setTemps(t);
        setMissing(m);
        setLoading(false);
      })
      .catch((err: Error) => { setError(err.message); setLoading(false); });
  }, [fromDate, toDate, stationFilter, userFilter]);

  // Temperature records have no station column in the schema (they're tied
  // to a plan), so station filter is only applied to the checklist dataset.
  // User filter for temps uses the user_id from the record.
  const filteredTemps = temps.filter(t => {
    if (userFilter && String(t.userId ?? "") !== userFilter) return false;
    return true;
  });

  const filteredChecklists = checklists.filter(c => {
    if (categoryFilter && c.category !== categoryFilter) return false;
    return true;
  });

  const filteredMissing = missing.filter(m => {
    if (categoryFilter && m.category !== categoryFilter) return false;
    return true;
  });

  // Pre-compute summary stats (no pass/fail split on temperatures since
  // readings span cooked-core, fridge, and delivery checks with different
  // thresholds).
  const uniqueCheckUsers = new Set(filteredChecklists.map(c => c.completedByName ?? "").filter(Boolean)).size;
  const uniqueStations = new Set(filteredChecklists.map(c => c.stationType)).size;

  const showChecks = kindFilter === "all" || kindFilter === "checklists";
  const showMissing = kindFilter === "all" || kindFilter === "outstanding";
  const showTemps = kindFilter === "all" || kindFilter === "temperatures";
  // When the user explicitly filters to Outstanding, hide the other
  // sections so the list is unambiguous.
  const outstandingOnly = kindFilter === "outstanding";

  function clearFilters() {
    setStationFilter("");
    setUserFilter("");
    setKindFilter("all");
    setCategoryFilter("");
  }

  const hasFilters = stationFilter || userFilter || kindFilter !== "all" || categoryFilter;

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading HACCP records…
    </div>
  );
  if (error) return (
    <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400 text-sm">{error}</div>
  );

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 px-4 py-3 flex items-start gap-3">
        <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-blue-800 dark:text-blue-300">HACCP Evidence Log</p>
          <p className="text-blue-700/80 dark:text-blue-300/80 mt-0.5">
            Daily opening/cleaning/closing checks and cooked-core temperature readings for EHO inspections.
            Use the filters below to narrow by date, station, or team member.
          </p>
        </div>
      </div>

      {/* Summary cards — 75°C pass/fail is no longer shown because not all
          readings are cooked-core (fridge, delivery, and ambient readings
          also land in this log). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard icon={<ClipboardCheck className="w-4 h-4 text-emerald-600" />} label="Checks Completed" value={String(filteredChecklists.length)} sub={`${uniqueCheckUsers} team member${uniqueCheckUsers !== 1 ? "s" : ""}, ${uniqueStations} station${uniqueStations !== 1 ? "s" : ""}`} />
        <SummaryCard
          icon={<AlertTriangle className={cn("w-4 h-4", filteredMissing.length > 0 ? "text-red-500" : "text-muted-foreground")} />}
          label="Outstanding Checks"
          value={String(filteredMissing.length)}
          sub={filteredMissing.length > 0 ? "Expected but not completed" : "All checks accounted for"}
          highlight={filteredMissing.length > 0 ? "red" : undefined}
        />
        <SummaryCard icon={<Thermometer className="w-4 h-4 text-blue-500" />} label="Temp Readings" value={String(filteredTemps.length)} sub={`${fromDate} → ${toDate}`} />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mr-1">Filter</span>
        <select
          value={kindFilter}
          onChange={e => setKindFilter(e.target.value as typeof kindFilter)}
          className="px-2.5 py-1.5 border border-border rounded-lg text-sm bg-background"
          title="Record type"
        >
          <option value="all">All records</option>
          <option value="checklists">Checklists only</option>
          <option value="outstanding">Outstanding only</option>
          <option value="temperatures">Temperatures only</option>
        </select>
        <select
          value={stationFilter}
          onChange={e => setStationFilter(e.target.value)}
          className="px-2.5 py-1.5 border border-border rounded-lg text-sm bg-background"
          title="Station"
        >
          <option value="">All stations</option>
          {Object.entries(STATION_LABELS_REPORT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select
          value={userFilter}
          onChange={e => setUserFilter(e.target.value)}
          className="px-2.5 py-1.5 border border-border rounded-lg text-sm bg-background"
          title="User"
        >
          <option value="">All users</option>
          {users.filter(u => u.isActive !== false).map(u => (
            <option key={u.id} value={String(u.id)}>{u.name}</option>
          ))}
        </select>
        {showChecks && (
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value as typeof categoryFilter)}
            className="px-2.5 py-1.5 border border-border rounded-lg text-sm bg-background"
            title="Checklist category"
          >
            <option value="">All categories</option>
            <option value="opening">Opening</option>
            <option value="cleaning">Cleaning</option>
            <option value="closing">Closing</option>
          </select>
        )}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Outstanding (expected but not completed) checklist items */}
      {showMissing && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setOutstandingOpen(v => !v)}
            className="w-full px-4 py-2.5 border-b border-border bg-red-50/40 dark:bg-red-950/20 flex items-center gap-2 text-left hover:bg-red-50/60 dark:hover:bg-red-950/30 transition-colors"
            aria-expanded={outstandingOpen}
          >
            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
            <h3 className="text-sm font-semibold">Outstanding Items ({filteredMissing.length})</h3>
            <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">Expected for the day but never ticked off</span>
            {outstandingOpen
              ? <ChevronUp className="w-4 h-4 text-muted-foreground ml-auto flex-shrink-0" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground ml-auto flex-shrink-0" />}
          </button>
          {outstandingOpen && (
            filteredMissing.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <ShieldCheck className="w-5 h-5 text-emerald-500 inline-block mr-1 align-text-bottom" />
                All expected checks have been completed in this date range.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-secondary/40 backdrop-blur-sm">
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Expected For</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Category</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Station</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Item</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredMissing.map(row => {
                      const meta = HACCP_CATEGORY_META[row.category];
                      return (
                        <tr key={row.id} className="hover:bg-secondary/10 transition-colors align-top">
                          <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap text-xs">
                            {row.planDate ? format(new Date(`${row.planDate}T12:00:00Z`), "dd MMM yyyy") : "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn("inline-block px-2 py-0.5 rounded-full text-xs font-semibold", meta.bg, meta.color)}>
                              {meta.label}
                            </span>
                            {row.kind === "oneoff-missing" && (
                              <span className="ml-1 text-[10px] text-amber-500 font-semibold uppercase">one-off</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                            {STATION_LABELS_REPORT[row.stationType] ?? row.stationType}
                          </td>
                          <td className="px-4 py-2.5 font-medium">{row.title}</td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 rounded-full px-2 py-0.5">
                              <AlertTriangle className="w-3 h-3" /> Not completed
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}

      {/* Checklist completions table */}
      {showChecks && !outstandingOnly && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setCompletedOpen(v => !v)}
            className="w-full px-4 py-2.5 border-b border-border bg-secondary/20 flex items-center gap-2 text-left hover:bg-secondary/40 transition-colors"
            aria-expanded={completedOpen}
          >
            <ClipboardCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <h3 className="text-sm font-semibold">Checklist Completions ({filteredChecklists.length})</h3>
            {completedOpen
              ? <ChevronUp className="w-4 h-4 text-muted-foreground ml-auto flex-shrink-0" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground ml-auto flex-shrink-0" />}
          </button>
          {completedOpen && (
            filteredChecklists.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No checklist completions for the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-secondary/40 backdrop-blur-sm">
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Completed</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Category</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Station</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Item</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">By</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredChecklists.map(row => {
                      const meta = HACCP_CATEGORY_META[row.category];
                      return (
                        <tr key={`${row.kind}-${row.id}`} className="hover:bg-secondary/10 transition-colors align-top">
                          <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap text-xs">
                            {format(new Date(row.completedAt), "dd MMM, HH:mm")}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn("inline-block px-2 py-0.5 rounded-full text-xs font-semibold", meta.bg, meta.color)}>
                              {meta.label}
                            </span>
                            {row.kind === "oneoff" && (
                              <span className="ml-1 text-[10px] text-amber-500 font-semibold uppercase">one-off</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                            {STATION_LABELS_REPORT[row.stationType] ?? row.stationType}
                          </td>
                          <td className="px-4 py-2.5 font-medium">{row.title}</td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{row.completedByName ?? "—"}</td>
                          <td className="px-4 py-2.5 text-muted-foreground text-xs max-w-[280px] whitespace-pre-wrap">
                            {row.notes ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}

      {/* Temperature records table — no pass/fail column since readings
          include cooked-core (≥75°C), fridge, delivery, and ambient
          values with different thresholds. */}
      {showTemps && !outstandingOnly && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setTempsOpen(v => !v)}
            className="w-full px-4 py-2.5 border-b border-border bg-secondary/20 flex items-center gap-2 text-left hover:bg-secondary/40 transition-colors"
            aria-expanded={tempsOpen}
          >
            <Thermometer className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <h3 className="text-sm font-semibold">Temperature Readings ({filteredTemps.length})</h3>
            {tempsOpen
              ? <ChevronUp className="w-4 h-4 text-muted-foreground ml-auto flex-shrink-0" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground ml-auto flex-shrink-0" />}
          </button>
          {tempsOpen && (
            filteredTemps.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No temperature records for the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-secondary/40 backdrop-blur-sm">
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Recorded</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Recipe</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Ingredient</th>
                      <th className="text-center px-4 py-2.5 font-semibold text-muted-foreground">Tray</th>
                      <th className="text-center px-4 py-2.5 font-semibold text-muted-foreground">Temp</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredTemps.map(rec => (
                      <tr key={rec.id} className="hover:bg-secondary/10 transition-colors">
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap text-xs">
                          {format(new Date(rec.recordedAt), "dd MMM, HH:mm")}
                        </td>
                        <td className="px-4 py-2.5 font-medium">{rec.recipeName ?? `Recipe #${rec.recipeId}`}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{rec.ingredientName ?? `Ingredient #${rec.ingredientId}`}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums">{rec.trayIndex + 1}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="font-bold tabular-nums text-foreground">
                            {parseFloat(rec.temperatureC).toFixed(1)}°C
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{rec.userName ?? "Unknown"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
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
  { value: "in_development", label: "In Development" },
  { value: "testing", label: "Testing" },
  { value: "complete", label: "Complete" },
  { value: "rejected", label: "Rejected" },
];

function statusRowClass(status: string) {
  if (status === "submitted_for_review") return "bg-yellow-50/60 dark:bg-yellow-900/10";
  if (status === "acknowledged") return "bg-violet-50/60 dark:bg-violet-900/10";
  if (status === "approved") return "bg-green-50/60 dark:bg-green-900/10";
  if (status === "in_development") return "bg-amber-50/60 dark:bg-amber-900/10";
  if (status === "testing") return "bg-blue-50/60 dark:bg-blue-900/10";
  if (status === "complete") return "bg-emerald-50/60 dark:bg-emerald-900/10";
  if (status === "rejected") return "bg-red-50/60 dark:bg-red-900/10";
  return "";
}

function statusBadgeClass(status: string) {
  if (status === "submitted_for_review") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
  if (status === "acknowledged") return "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400";
  if (status === "approved") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (status === "in_development") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  if (status === "testing") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  if (status === "complete") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 font-semibold";
  if (status === "rejected") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  return "bg-secondary text-muted-foreground";
}

function statusSelectClass(status: string) {
  if (status === "submitted_for_review") return "border-yellow-300 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-700";
  if (status === "acknowledged") return "border-violet-300 bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-700";
  if (status === "approved") return "border-green-300 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 dark:border-green-700";
  if (status === "in_development") return "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700";
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

  // Detail dialog state
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [comments, setComments] = useState<ImprovementComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  const selectedImp = selectedId !== null ? improvements.find(i => i.id === selectedId) ?? null : null;

  const loadComments = useCallback(async (id: number) => {
    setCommentsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/improvements/${id}/comments`, { credentials: "include" });
      if (res.ok) setComments(await res.json());
    } catch { /* ignore */ }
    setCommentsLoading(false);
  }, []);

  const openDetail = (id: number) => {
    setSelectedId(id);
    setNewComment("");
    loadComments(id);
  };

  const postComment = async () => {
    if (!selectedId || !newComment.trim()) return;
    setPostingComment(true);
    try {
      const res = await fetch(`${BASE}/api/improvements/${selectedId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ comment: newComment.trim() }),
      });
      if (res.ok) {
        const row = await res.json();
        setComments(prev => [...prev, row]);
        setNewComment("");
        setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    } catch {
      toast({ title: "Failed to post comment", variant: "destructive" });
    }
    setPostingComment(false);
  };

  // Filters
  const [viewTab, setViewTab] = useState<"all" | "mine">("all");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterStation, setFilterStation] = useState("");
  const [filterTier, setFilterTier] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const debouncedFilterSearch = useDebouncedValue(filterSearch);
  const [filterType, setFilterType] = useState("");

  const isManager = userRole === "admin" || userRole === "manager";

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/improvements`, { credentials: "include" });
      if (res.ok) setImprovements(await res.json());
    } catch (err) {
      console.warn("[Reports] Failed to load improvements:", err);
      toast({ title: "Failed to load improvements", variant: "destructive" });
    }
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
    } catch (err) {
      console.warn("[Reports] Failed to update improvement:", err);
      toast({ title: "Update failed", description: "Could not update improvement.", variant: "destructive" });
    }
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
    } catch (err) {
      console.warn("[Reports] Delete improvement failed:", err);
      alert("Failed to delete entry");
    }
  }

  const filtered = improvements.filter(imp => {
    if (viewTab === "mine" && imp.submittedByName !== currentUserName) return false;
    if (filterStatus && imp.progressStatus !== filterStatus) return false;
    if (filterStation && imp.station !== filterStation) return false;
    if (filterTier && (imp.approvalTier ?? "") !== filterTier) return false;
    if (filterType && (imp.type ?? "improvement") !== filterType) return false;
    if (debouncedFilterSearch) {
      const q = debouncedFilterSearch.toLowerCase();
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
                <tr key={imp.id} className={cn("transition-colors align-top cursor-pointer hover:bg-secondary/40", statusRowClass(imp.progressStatus))} onClick={() => openDetail(imp.id)}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{imp.title}</p>
                    {imp.description && <p className="text-xs text-muted-foreground mt-0.5 max-w-xs line-clamp-2">{imp.description}</p>}
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
                  <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
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
                  <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
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
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
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
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
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

      {/* Detail dialog */}
      <Dialog open={selectedId !== null} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          {selectedImp && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "px-2.5 py-0.5 rounded-full text-xs font-medium",
                    (selectedImp.type ?? "improvement") === "struggle"
                      ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  )}>
                    {(selectedImp.type ?? "improvement") === "struggle" ? "Struggle" : "Improvement"}
                  </span>
                  <span className={cn("px-2 py-0.5 rounded-full text-xs", statusBadgeClass(selectedImp.progressStatus))}>
                    {IMPROVEMENT_PROGRESS_OPTIONS.find(o => o.value === selectedImp.progressStatus)?.label ?? selectedImp.progressStatus}
                  </span>
                  {selectedImp.approvalTier && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-secondary text-muted-foreground capitalize">
                      {selectedImp.approvalTier}
                    </span>
                  )}
                </div>
                <DialogTitle className="text-xl">{selectedImp.title}</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {STATION_LABELS_REPORT[selectedImp.station] ?? selectedImp.station}
                  {" · "}
                  {selectedImp.submittedByName ?? "Unknown"}
                  {" · "}
                  {selectedImp.createdAt ? format(new Date(selectedImp.createdAt), "d MMM yyyy, HH:mm") : "—"}
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto space-y-4 mt-2">
                {/* Full description */}
                <div className="bg-secondary/30 rounded-xl p-4">
                  <p className="text-sm font-medium text-muted-foreground mb-1">Description</p>
                  <p className="text-sm whitespace-pre-wrap">{selectedImp.description}</p>
                </div>

                {/* Report context */}
                {selectedImp.reportContext && (
                  <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/50 rounded-xl px-4 py-3 flex items-start gap-2">
                    <Package className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-0.5">Reported from</p>
                      <p className="text-sm text-blue-800 dark:text-blue-300">{selectedImp.reportContext}</p>
                    </div>
                  </div>
                )}

                {/* Manager notes */}
                {selectedImp.notes && (
                  <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/50 rounded-xl p-4">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">Manager Notes</p>
                    <p className="text-sm whitespace-pre-wrap">{selectedImp.notes}</p>
                  </div>
                )}

                {/* Comments section */}
                <div className="border-t border-border pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-semibold">Comments ({comments.length})</p>
                  </div>

                  {commentsLoading ? (
                    <div className="flex items-center justify-center py-6 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />Loading...
                    </div>
                  ) : comments.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic py-3">No comments yet. Be the first to add an update.</p>
                  ) : (
                    <div className="space-y-3 max-h-[240px] overflow-y-auto pr-1">
                      {comments.map(c => (
                        <div key={c.id} className="bg-secondary/20 rounded-lg px-3.5 py-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium">{c.userName ?? "Unknown"}</span>
                            <span className="text-xs text-muted-foreground">{format(new Date(c.createdAt), "d MMM yyyy, HH:mm")}</span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{c.comment}</p>
                        </div>
                      ))}
                      <div ref={commentsEndRef} />
                    </div>
                  )}

                  {/* Add comment input */}
                  <div className="flex items-start gap-2 mt-3">
                    <textarea
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      placeholder="Add a comment or update..."
                      rows={2}
                      className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) postComment(); }}
                    />
                    <button
                      type="button"
                      onClick={postComment}
                      onTouchEnd={e => { e.preventDefault(); postComment(); }}
                      disabled={!newComment.trim() || postingComment}
                      className={cn(
                        "px-3 py-2 rounded-lg transition-all mt-0.5 touch-manipulation",
                        newComment.trim()
                          ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow active:scale-95"
                          : "bg-secondary text-muted-foreground cursor-not-allowed"
                      )}
                    >
                      {postingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Press Cmd+Enter to send</p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
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

interface AndonComment {
  id: number;
  andonId: number;
  userId: number | null;
  userName: string | null;
  comment: string;
  createdAt: string;
}

// ─── Leftover Filling Tab ───────────────────────────────────────────────────

interface LeftoverFillingRecipe {
  recipeId: number;
  recipeName: string;
  count: number;
  totalGrams: number;
  avgGrams: number;
  minGrams: number;
  maxGrams: number;
  entries: { planDate: string; grams: number }[];
}

function LeftoverFillingTab({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const [data, setData] = useState<LeftoverFillingRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRecipe, setExpandedRecipe] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    fetch(`${BASE}/api/reports/leftover-filling?${params.toString()}`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error("Failed to fetch"); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [fromDate, toDate]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (error) return <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-red-600 dark:text-red-400">{error}</div>;
  if (data.length === 0) return (
    <div className="text-center py-16 text-muted-foreground">
      <Droplets className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="font-medium">No leftover filling data recorded</p>
      <p className="text-sm mt-1">Leftover filling weights will appear here once builders record them after completing recipes.</p>
    </div>
  );

  const sorted = [...data].sort((a, b) => b.avgGrams - a.avgGrams);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/30 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-3 font-medium text-left">Recipe</th>
              <th className="px-4 py-3 font-medium text-right">Days Recorded</th>
              <th className="px-4 py-3 font-medium text-right">Avg Leftover</th>
              <th className="px-4 py-3 font-medium text-right">Min</th>
              <th className="px-4 py-3 font-medium text-right">Max</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {sorted.map(recipe => (
              <Fragment key={recipe.recipeId}>
                <tr
                  onClick={() => setExpandedRecipe(expandedRecipe === recipe.recipeId ? null : recipe.recipeId)}
                  className="hover:bg-secondary/20 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", expandedRecipe === recipe.recipeId && "rotate-90")} />
                      {recipe.recipeName}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{recipe.count}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn(
                      "font-bold",
                      recipe.avgGrams === 0 ? "text-emerald-600 dark:text-emerald-400" :
                      recipe.avgGrams <= 200 ? "text-amber-600 dark:text-amber-400" :
                      "text-red-600 dark:text-red-400"
                    )}>
                      {recipe.avgGrams}g
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{recipe.minGrams}g</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{recipe.maxGrams}g</td>
                </tr>
                {expandedRecipe === recipe.recipeId && (
                  <tr>
                    <td colSpan={5} className="px-4 py-2 bg-secondary/10">
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 py-2">
                        {recipe.entries.map((entry, i) => (
                          <div key={i} className="text-xs bg-card border border-border rounded-lg px-3 py-2 text-center">
                            <p className="text-muted-foreground">{format(new Date(entry.planDate + "T00:00:00"), "d MMM")}</p>
                            <p className={cn("font-bold", entry.grams === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>{entry.grams}g</p>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AndonLogTab({ userRole, initialIssueId }: { userRole: string; initialIssueId?: number }) {
  const [issues, setIssues] = useState<AndonIssueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<number | null>(null);
  const [stationFilter, setStationFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [showResolved, setShowResolved] = useState(false);

  // Detail dialog + comments state (mirrors ImprovementsTab)
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [comments, setComments] = useState<AndonComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  const selectedIssue = selectedId !== null ? issues.find(i => i.id === selectedId) ?? null : null;

  const isManager = userRole === "admin" || userRole === "manager";

  const loadComments = useCallback(async (id: number) => {
    setCommentsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/andon/${id}/comments`, { credentials: "include" });
      if (res.ok) setComments(await res.json());
    } catch { /* ignore */ }
    setCommentsLoading(false);
  }, []);

  const openDetail = (id: number) => {
    setSelectedId(id);
    setNewComment("");
    loadComments(id);
  };

  const postComment = async () => {
    if (!selectedId || !newComment.trim()) return;
    setPostingComment(true);
    try {
      const res = await fetch(`${BASE}/api/andon/${selectedId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ comment: newComment.trim() }),
      });
      if (res.ok) {
        const row = await res.json();
        setComments(prev => [...prev, row]);
        setNewComment("");
        setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    } catch {
      toast({ title: "Failed to post comment", variant: "destructive" });
    }
    setPostingComment(false);
  };

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (stationFilter) params.set("station", stationFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      if (severityFilter) params.set("severity", severityFilter);
      const res = await fetch(`${BASE}/api/andon?${params.toString()}`, { credentials: "include" });
      if (res.ok) setIssues(await res.json());
    } catch (err) {
      console.warn("[Reports] Failed to load andon issues:", err);
      toast({ title: "Failed to load issues", variant: "destructive" });
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [stationFilter, categoryFilter, severityFilter]);

  // Deep-link: auto-open an issue if navigated with ?issueId=N
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (initialIssueId && !loading && issues.length > 0 && !didAutoOpen.current) {
      didAutoOpen.current = true;
      if (issues.some(i => i.id === initialIssueId)) {
        openDetail(initialIssueId);
      }
    }
  }, [initialIssueId, loading, issues]);

  async function acknowledge(id: number) {
    setActioningId(id);
    try {
      await fetch(`${BASE}/api/andon/${id}/acknowledge`, { method: "PATCH", credentials: "include" });
      await load();
    } catch (err) {
      console.warn("[Reports] Failed to acknowledge issue:", err);
      toast({ title: "Acknowledge failed", variant: "destructive" });
    }
    setActioningId(null);
  }

  async function resolve(id: number) {
    setActioningId(id);
    try {
      await fetch(`${BASE}/api/andon/${id}/resolve`, { method: "PATCH", credentials: "include" });
      await load();
    } catch (err) {
      console.warn("[Reports] Failed to resolve issue:", err);
      toast({ title: "Resolve failed", variant: "destructive" });
    }
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
        <button
          type="button"
          onClick={() => setShowResolved(prev => !prev)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm transition-colors",
            showResolved
              ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
              : "border-border bg-background text-muted-foreground hover:bg-secondary"
          )}
        >
          {showResolved ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showResolved ? "Hide Resolved" : "Show Resolved"}
          {!showResolved && issues.filter(i => !!i.resolvedAt).length > 0 && (
            <span className="text-xs bg-secondary px-1.5 py-0.5 rounded-full">{issues.filter(i => !!i.resolvedAt).length}</span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : issues.filter(i => showResolved || !i.resolvedAt).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-muted-foreground">
            {issues.length === 0 ? "No issues found" : "All issues resolved"}
          </p>
          {issues.length > 0 && !showResolved && (
            <button type="button" onClick={() => setShowResolved(true)} className="mt-2 text-sm text-primary hover:underline">
              Show {issues.filter(i => !!i.resolvedAt).length} resolved issue{issues.filter(i => !!i.resolvedAt).length !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-muted-foreground text-xs">
              <tr>
                <th className="px-4 py-3 font-medium text-left">Severity</th>
                {isManager && <th className="px-4 py-3 font-medium text-center">Actions</th>}
                <th className="px-4 py-3 font-medium text-left">Category</th>
                <th className="px-4 py-3 font-medium text-left">Station</th>
                <th className="px-4 py-3 font-medium text-left">Description</th>
                <th className="px-4 py-3 font-medium text-left">Reported by</th>
                <th className="px-4 py-3 font-medium text-left">Submitted</th>
                <th className="px-4 py-3 font-medium text-left">Acknowledged</th>
                <th className="px-4 py-3 font-medium text-left">Resolved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {issues.filter(issue => showResolved || !issue.resolvedAt).map(issue => (
                <tr
                  key={issue.id}
                  onClick={() => openDetail(issue.id)}
                  className="hover:bg-secondary/20 cursor-pointer transition-colors align-top"
                >
                  <td className="px-4 py-3">
                    <span className={cn(
                      "flex items-center gap-1.5 text-xs font-bold",
                      issue.severity === "red" ? "text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400"
                    )}>
                      <span className={cn("w-2 h-2 rounded-full", issue.severity === "red" ? "bg-red-500" : "bg-yellow-400")} />
                      {issue.severity === "red" ? "Serious" : "Minor"}
                    </span>
                  </td>
                  {isManager && (
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
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
                  <td className="px-4 py-3 text-muted-foreground capitalize">
                    {ANDON_CATEGORY_LABELS[issue.category] ?? issue.category}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {STATION_LABELS_REPORT[issue.station] ?? issue.station}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[300px]">
                    <span className="line-clamp-3 whitespace-pre-wrap">{issue.description ?? "—"}</span>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail dialog (mirrors ImprovementsTab) */}
      <Dialog open={selectedId !== null} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          {selectedIssue && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold",
                    selectedIssue.severity === "red"
                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                  )}>
                    <span className={cn("w-2 h-2 rounded-full", selectedIssue.severity === "red" ? "bg-red-500" : "bg-yellow-400")} />
                    {selectedIssue.severity === "red" ? "Serious" : "Minor"}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-muted-foreground capitalize">
                    {ANDON_CATEGORY_LABELS[selectedIssue.category] ?? selectedIssue.category}
                  </span>
                  {selectedIssue.resolvedAt ? (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-semibold">Resolved</span>
                  ) : selectedIssue.acknowledgedAt ? (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">Acknowledged</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">Open</span>
                  )}
                </div>
                <DialogTitle className="text-xl">
                  {selectedIssue.description && selectedIssue.description.trim()
                    ? selectedIssue.description.split("\n")[0].slice(0, 100)
                    : `${ANDON_CATEGORY_LABELS[selectedIssue.category] ?? selectedIssue.category} issue`}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {STATION_LABELS_REPORT[selectedIssue.station] ?? selectedIssue.station}
                  {" · "}
                  {selectedIssue.reportedByName ?? "Unknown"}
                  {" · "}
                  {selectedIssue.createdAt ? format(new Date(selectedIssue.createdAt), "d MMM yyyy, HH:mm") : "—"}
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto space-y-4 mt-2">
                {/* Full description */}
                {selectedIssue.description && (
                  <div className="bg-secondary/30 rounded-xl p-4">
                    <p className="text-sm font-medium text-muted-foreground mb-1">Description</p>
                    <p className="text-sm whitespace-pre-wrap">{selectedIssue.description}</p>
                  </div>
                )}

                {/* Resolution metadata */}
                {(selectedIssue.acknowledgedAt || selectedIssue.resolvedAt) && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {selectedIssue.acknowledgedAt && (
                      <div className="bg-violet-50/50 dark:bg-violet-950/20 border border-violet-200/50 dark:border-violet-800/50 rounded-xl px-3 py-2">
                        <p className="font-medium text-violet-700 dark:text-violet-400">Acknowledged</p>
                        <p className="text-muted-foreground">{selectedIssue.acknowledgedByName ?? "—"}</p>
                        <p className="text-muted-foreground">{format(new Date(selectedIssue.acknowledgedAt), "d MMM yyyy, HH:mm")}</p>
                      </div>
                    )}
                    {selectedIssue.resolvedAt && (
                      <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/50 rounded-xl px-3 py-2">
                        <p className="font-medium text-emerald-700 dark:text-emerald-400">Resolved</p>
                        <p className="text-muted-foreground">{selectedIssue.resolvedByName ?? "—"}</p>
                        <p className="text-muted-foreground">{format(new Date(selectedIssue.resolvedAt), "d MMM yyyy, HH:mm")}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Manager quick actions */}
                {isManager && (!selectedIssue.acknowledgedAt || !selectedIssue.resolvedAt) && (
                  <div className="flex gap-2">
                    {!selectedIssue.acknowledgedAt && (
                      <button
                        onClick={() => acknowledge(selectedIssue.id)}
                        disabled={actioningId === selectedIssue.id}
                        className="flex items-center gap-1.5 text-sm px-3 py-2 border border-border rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Acknowledge
                      </button>
                    )}
                    {!selectedIssue.resolvedAt && (
                      <button
                        onClick={() => resolve(selectedIssue.id)}
                        disabled={actioningId === selectedIssue.id}
                        className="flex items-center gap-1.5 text-sm px-3 py-2 border border-emerald-500 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors disabled:opacity-50"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Resolve
                      </button>
                    )}
                  </div>
                )}

                {/* Comments section */}
                <div className="border-t border-border pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-semibold">Comments ({comments.length})</p>
                  </div>

                  {commentsLoading ? (
                    <div className="flex items-center justify-center py-6 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />Loading...
                    </div>
                  ) : comments.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic py-3">No comments yet. Be the first to add an update.</p>
                  ) : (
                    <div className="space-y-3 max-h-[240px] overflow-y-auto pr-1">
                      {comments.map(c => (
                        <div key={c.id} className="bg-secondary/20 rounded-lg px-3.5 py-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium">{c.userName ?? "Unknown"}</span>
                            <span className="text-xs text-muted-foreground">{format(new Date(c.createdAt), "d MMM yyyy, HH:mm")}</span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{c.comment}</p>
                        </div>
                      ))}
                      <div ref={commentsEndRef} />
                    </div>
                  )}

                  {/* Add comment input */}
                  <div className="flex items-start gap-2 mt-3">
                    <textarea
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      placeholder="Add a comment or update..."
                      rows={2}
                      className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) postComment(); }}
                    />
                    <button
                      type="button"
                      onClick={postComment}
                      onTouchEnd={e => { e.preventDefault(); postComment(); }}
                      disabled={!newComment.trim() || postingComment}
                      className={cn(
                        "px-3 py-2 rounded-lg transition-all mt-0.5 touch-manipulation",
                        newComment.trim()
                          ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow active:scale-95"
                          : "bg-secondary text-muted-foreground cursor-not-allowed"
                      )}
                    >
                      {postingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Press Cmd+Enter to send</p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Employee Records tab ───────────────────────────────────────────────────

interface EmployeeAttendanceRow {
  userId: number;
  userName: string;
  userEmail: string;
  role: string;
  plandayEmployeeId: number | null;
  linked: boolean;
  totalShifts: number;
  lateShifts: number;
  sickShifts: number;
  sickUnpaidShifts: number;
}

interface AttendanceResponse {
  available: boolean;
  from: string;
  to: string;
  rows: EmployeeAttendanceRow[];
  unmatchedAppUsers: Array<{ userId: number; name: string; email: string }>;
  shiftTypeNames: string[];
  absenceAccountNames: string[];
}

function EmployeesTab({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUnlinked, setShowUnlinked] = useState(false);

  useEffect(() => {
    if (!fromDate || !toDate) return;
    setLoading(true);
    const params = new URLSearchParams({ from: fromDate, to: toDate });
    fetch(`${BASE}/api/employees/attendance?${params.toString()}`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error("Failed"); return r.json() as Promise<AttendanceResponse>; })
      .then(d => { setData(d); setLoading(false); })
      .catch((err) => {
        console.warn("[Reports] Employees fetch failed:", err);
        toast({ title: "Failed to load employee records", variant: "destructive" });
        setData(null);
        setLoading(false);
      });
  }, [fromDate, toDate]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-center text-muted-foreground py-8">Failed to load employee records</div>;
  }

  if (!data.available) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm">
        <div className="font-medium text-amber-900 mb-1">Plan Day is not configured</div>
        <p className="text-amber-800">
          Set <code className="bg-amber-100 px-1 rounded">PLANDAY_CLIENT_ID</code>,{" "}
          <code className="bg-amber-100 px-1 rounded">PLANDAY_REFRESH_TOKEN</code>, and{" "}
          <code className="bg-amber-100 px-1 rounded">PLANDAY_DEPARTMENT_ID</code> to enable attendance records.
        </p>
      </div>
    );
  }

  const linkedRows = data.rows.filter(r => r.linked);
  const rowsToShow = showUnlinked ? data.rows : linkedRows;

  const totals = linkedRows.reduce(
    (acc, r) => ({
      total: acc.total + r.totalShifts,
      late: acc.late + r.lateShifts,
      sick: acc.sick + r.sickShifts,
      sickUnpaid: acc.sickUnpaid + r.sickUnpaidShifts,
    }),
    { total: 0, late: 0, sick: 0, sickUnpaid: 0 },
  );

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          icon={<Users className="w-5 h-5 text-blue-600" />}
          label="Total Shifts"
          value={String(totals.total)}
          sub={`${linkedRows.length} linked employee${linkedRows.length === 1 ? "" : "s"}`}
        />
        <SummaryCard
          icon={<Clock className="w-5 h-5 text-amber-600" />}
          label="Arrived Late"
          value={String(totals.late)}
          sub={totals.total > 0 ? `${Math.round((totals.late / totals.total) * 100)}% of shifts` : "—"}
        />
        <SummaryCard
          icon={<Thermometer className="w-5 h-5 text-rose-600" />}
          label="Sick"
          value={String(totals.sick)}
          sub={totals.total > 0 ? `${Math.round((totals.sick / totals.total) * 100)}% of shifts` : "—"}
        />
        <SummaryCard
          icon={<AlertTriangle className="w-5 h-5 text-red-700" />}
          label="Sick Unpaid"
          value={String(totals.sickUnpaid)}
          sub={totals.total > 0 ? `${Math.round((totals.sickUnpaid / totals.total) * 100)}% of shifts` : "—"}
        />
      </div>

      {data.unmatchedAppUsers.length > 0 && (
        <div className="bg-secondary/50 border border-border rounded-xl p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="font-medium">{data.unmatchedAppUsers.length}</span>{" "}
              app user{data.unmatchedAppUsers.length === 1 ? "" : "s"} could not be matched to a Plan Day employee by email.
            </div>
            <button
              onClick={() => setShowUnlinked(v => !v)}
              className="text-xs px-2 py-1 rounded-md bg-background border border-border hover:bg-secondary transition-colors"
            >
              {showUnlinked ? "Hide unlinked" : "Show unlinked"}
            </button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/50 border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Employee</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">Total shifts</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">Arrived late</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">Late %</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">Sick</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">Sick unpaid</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">Sick %</th>
              </tr>
            </thead>
            <tbody>
              {rowsToShow.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-muted-foreground py-8">
                    No employees to show.
                  </td>
                </tr>
              )}
              {rowsToShow.map(r => {
                const latePct = r.totalShifts > 0 ? (r.lateShifts / r.totalShifts) * 100 : 0;
                const sickTotal = r.sickShifts + r.sickUnpaidShifts;
                const sickPct = r.totalShifts > 0 ? (sickTotal / r.totalShifts) * 100 : 0;
                const fmtPct = (n: number) => n === 0 ? "—" : `${n.toFixed(1)}%`;
                return (
                  <tr
                    key={r.userId}
                    className={cn(
                      "border-b border-border last:border-b-0",
                      !r.linked && "opacity-60",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.userName}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.userEmail}
                        {!r.linked && <span className="ml-2 text-amber-600">• not linked</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.totalShifts}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {r.lateShifts > 0 ? <span className="text-amber-700 font-medium">{r.lateShifts}</span> : r.lateShifts}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {r.lateShifts > 0 ? <span className="text-amber-700">{fmtPct(latePct)}</span> : fmtPct(latePct)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {r.sickShifts > 0 ? <span className="text-rose-700 font-medium">{r.sickShifts}</span> : r.sickShifts}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {r.sickUnpaidShifts > 0 ? <span className="text-red-800 font-medium">{r.sickUnpaidShifts}</span> : r.sickUnpaidShifts}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {sickTotal > 0 ? <span className="text-rose-700">{fmtPct(sickPct)}</span> : fmtPct(sickPct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {(data.shiftTypeNames.length > 0 || data.absenceAccountNames.length > 0) && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Plan Day data sources</summary>
          {data.shiftTypeNames.length > 0 && (
            <div className="mt-2">
              <div className="font-medium mb-1">Shift types ({data.shiftTypeNames.length})</div>
              <div className="flex flex-wrap gap-1">
                {data.shiftTypeNames.map(name => (
                  <span key={name} className="px-2 py-0.5 rounded-md bg-secondary">{name}</span>
                ))}
              </div>
            </div>
          )}
          {data.absenceAccountNames.length > 0 && (
            <div className="mt-2">
              <div className="font-medium mb-1">Absence accounts ({data.absenceAccountNames.length})</div>
              <div className="flex flex-wrap gap-1">
                {data.absenceAccountNames.map(name => (
                  <span key={name} className="px-2 py-0.5 rounded-md bg-secondary">{name}</span>
                ))}
              </div>
            </div>
          )}
          <p className="mt-2">
            Shift types containing “late” count as Arrived Late. Absence records are classified by their account name: “sick unpaid” → Sick Unpaid, other “sick” → Sick.
          </p>
        </details>
      )}
    </>
  );
}
