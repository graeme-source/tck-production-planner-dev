import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearch, useLocation } from "wouter";
import { toast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, subWeeks, subMonths, isToday, isYesterday, isSameDay, addDays, addWeeks, differenceInCalendarDays } from "date-fns";
import {
  Loader2, Coffee, Utensils, Clock, Users,
  ArrowUp, ArrowDown, Minus as MinusIcon,
  TrendingUp, TrendingDown, Activity, Layers, Target, Timer,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Thermometer, ShieldCheck,
  Package, Zap, Calendar as CalendarIcon, CalendarDays, Trophy, Snail, Hourglass,
  Lightbulb, AlertTriangle, CheckCircle, Filter, Play, Square,
  MessageSquare, Send, ClipboardCheck, FileText, Eye, EyeOff,
  Droplets, UserCog, ClipboardList, Flame, HardHat, Printer, Check, Pencil, Plus,
  PoundSterling, Sunrise, Sunset,
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
  totalMacPacks?: number;
  totalActiveMinutes: number;
  overallBph: number;
  macPacksPerHour?: number;
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
  mac_cheese_packs: "Mac Cheese Packs",
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
type TabId = "kpis" | "breaks" | "haccp" | "risk-assessments" | "improvements" | "issues" | "leftover-filling" | "employees" | "printables";

// HACCP is being built out into a full food-safety system, so it gets its
// own sub-navigation. Temperature Log lives here too — fridge, freezer, and
// cooked-core readings are all food-safety evidence.
type HaccpSubTabId = "evidence" | "temperatures" | "cooling-weights";

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
  severity: "green" | "yellow" | "red";
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

const VALID_TABS: TabId[] = ["kpis", "breaks", "haccp", "risk-assessments", "improvements", "issues", "leftover-filling", "employees", "printables"];
const VALID_HACCP_SUBTABS: HaccpSubTabId[] = ["evidence", "temperatures", "cooling-weights"];

interface ReportsNavItem {
  id: TabId;
  label: string;
  icon: typeof TrendingUp;
}

const REPORTS_NAV_ITEMS: ReportsNavItem[] = [
  { id: "kpis", label: "Production KPIs", icon: TrendingUp },
  { id: "breaks", label: "Breaks & Lunches", icon: Coffee },
  { id: "haccp", label: "HACCP", icon: ShieldCheck },
  { id: "risk-assessments", label: "Documents", icon: ClipboardList },
  { id: "improvements", label: "Improvements & Struggles", icon: Lightbulb },
  { id: "issues", label: "Issue Log", icon: AlertTriangle },
  { id: "leftover-filling", label: "Leftover Filling", icon: Droplets },
  { id: "employees", label: "Employee Records", icon: UserCog },
  { id: "printables", label: "Printables", icon: Printer },
];

interface HaccpSubNavItem {
  id: HaccpSubTabId;
  label: string;
  icon: typeof TrendingUp;
}

const HACCP_SUB_NAV_ITEMS: HaccpSubNavItem[] = [
  { id: "evidence", label: "Evidence Log", icon: ShieldCheck },
  { id: "temperatures", label: "Temperature Log", icon: Thermometer },
  { id: "cooling-weights", label: "Cooling & Weights", icon: Hourglass },
];

// Tabs only visible to admins (not managers). Empty — no admin-gated tabs right now.
const ADMIN_ONLY_TABS: TabId[] = [];

export default function Reports() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { state, requireSensitivePin } = useAuth();
  const userRole = state.status === "authenticated" ? state.user.role : "viewer";
  const isManagerOrAdmin = userRole === "admin" || userRole === "manager";

  // Require PIN re-entry on entering Analytics (5-min unlock window).
  useEffect(() => {
    if (state.status === "authenticated" && isManagerOrAdmin) requireSensitivePin();
  }, [state.status, isManagerOrAdmin, requireSensitivePin]);

  // Viewers only see the Issue Log tab; managers see everything except admin-only tabs; admins see everything.
  const isAdmin = userRole === "admin";
  const visibleTabs = isManagerOrAdmin
    ? (isAdmin ? REPORTS_NAV_ITEMS : REPORTS_NAV_ITEMS.filter(item => !ADMIN_ONLY_TABS.includes(item.id)))
    : REPORTS_NAV_ITEMS.filter(item => item.id === "issues");
  const allowedTabIds = visibleTabs.map(t => t.id);

  const rawTab = new URLSearchParams(search).get("tab");
  const rawHaccpSub = new URLSearchParams(search).get("haccp");
  const issueIdParam = new URLSearchParams(search).get("issueId");
  // Backward compat: legacy "andon" redirects to "issues", "packing-speed"
  // redirects to "kpis" (now a subsection there), the old top-level
  // "batch-weights" tab now lives under HACCP → Cooling & Weights, and
  // the old top-level "temperature" tab now lives under HACCP → Temperature Log.
  const normalisedTab =
    rawTab === "andon" ? "issues"
      : rawTab === "packing-speed" ? "kpis"
      : rawTab === "batch-weights" ? "haccp"
      : rawTab === "temperature" ? "haccp"
      : rawTab;
  const normalisedHaccpSub =
    rawTab === "batch-weights" ? "cooling-weights"
      : rawTab === "temperature" ? "temperatures"
      : rawHaccpSub;
  const queryTab = normalisedTab as TabId | null;
  const initialTab: TabId = queryTab && allowedTabIds.includes(queryTab) ? queryTab : allowedTabIds[0];
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  const initialHaccpSub: HaccpSubTabId =
    normalisedHaccpSub && (VALID_HACCP_SUBTABS as string[]).includes(normalisedHaccpSub)
      ? (normalisedHaccpSub as HaccpSubTabId)
      : "evidence";
  const [haccpSubTab, setHaccpSubTab] = useState<HaccpSubTabId>(initialHaccpSub);

  function switchTab(tab: TabId) {
    setActiveTab(tab);
    const params = new URLSearchParams();
    if (tab !== "kpis") params.set("tab", tab);
    // Preserve the HACCP sub-tab when switching into HACCP so deep links
    // stay intact; other tabs drop the sub-tab param.
    if (tab === "haccp" && haccpSubTab !== "evidence") params.set("haccp", haccpSubTab);
    const qs = params.toString();
    navigate(`/reports${qs ? `?${qs}` : ""}`, { replace: true });
  }

  function switchHaccpSubTab(sub: HaccpSubTabId) {
    setHaccpSubTab(sub);
    const params = new URLSearchParams();
    params.set("tab", "haccp");
    if (sub !== "evidence") params.set("haccp", sub);
    navigate(`/reports?${params.toString()}`, { replace: true });
  }

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);

  // Temperature Log drives its own week-by-week navigation, so the global
  // From/To picker is hidden when that sub-tab is active.
  const onTemperatureSubTab = activeTab === "haccp" && haccpSubTab === "temperatures";
  const showDatePicker = activeTab !== "improvements" && activeTab !== "issues" && !onTemperatureSubTab;

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
                    {item.id === "haccp" && active && (
                      <ul className="mt-1 ml-4 pl-3 border-l border-border space-y-0.5">
                        {HACCP_SUB_NAV_ITEMS.map(sub => {
                          const SubIcon = sub.icon;
                          const subActive = haccpSubTab === sub.id;
                          return (
                            <li key={sub.id}>
                              <button
                                onClick={() => switchHaccpSubTab(sub.id)}
                                className={cn(
                                  "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                                  subActive
                                    ? "bg-secondary text-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                                )}
                              >
                                <SubIcon className="w-3.5 h-3.5 flex-shrink-0" />
                                {sub.label}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
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
          {activeTab === "haccp" && (
            <>
              {/* Mobile HACCP sub-nav — desktop sub-nav lives in the sidebar. */}
              <nav className="md:hidden w-full overflow-x-auto pb-2 -mb-2">
                <ul className="flex gap-1 min-w-max">
                  {HACCP_SUB_NAV_ITEMS.map(sub => {
                    const SubIcon = sub.icon;
                    const subActive = haccpSubTab === sub.id;
                    return (
                      <li key={sub.id}>
                        <button
                          onClick={() => switchHaccpSubTab(sub.id)}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors whitespace-nowrap",
                            subActive
                              ? "bg-secondary text-foreground font-medium"
                              : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                          )}
                        >
                          <SubIcon className="w-3.5 h-3.5 flex-shrink-0" />
                          {sub.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              {haccpSubTab === "evidence" && <HaccpTab fromDate={fromDate} toDate={toDate} />}
              {haccpSubTab === "temperatures" && <TemperatureRecordsTab />}
              {haccpSubTab === "cooling-weights" && <BatchWeightsTab fromDate={fromDate} toDate={toDate} />}
            </>
          )}
          {activeTab === "risk-assessments" && <RiskAssessmentsTab userRole={userRole} currentUserName={state.status === "authenticated" ? state.user.name : null} />}
          {activeTab === "improvements" && <ImprovementsTab userRole={userRole} currentUserName={state.status === "authenticated" ? state.user.name : null} />}
          {activeTab === "issues" && <AndonLogTab userRole={userRole} initialIssueId={issueIdParam ? parseInt(issueIdParam, 10) : undefined} />}
          {activeTab === "leftover-filling" && <LeftoverFillingTab fromDate={fromDate} toDate={toDate} />}
          {activeTab === "employees" && isManagerOrAdmin && <EmployeesTab fromDate={fromDate} toDate={toDate} />}
          {activeTab === "printables" && <PrintablesTab />}
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
          sub={(data.overview.totalMacPacks ?? 0) > 0
            ? `Calzone batches · +${data.overview.totalMacPacks} mac packs`
            : "Both builders combined"}
        />
        <SummaryCard
          icon={<Activity className="w-5 h-5 text-violet-600" />}
          label="Batches / Hour"
          value={String(data.overview.overallBph)}
          sub={(data.overview.macPacksPerHour ?? 0) > 0
            ? `Calzone · mac packs: ${data.overview.macPacksPerHour}/hr`
            : "Both building tables added"}
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

// Unified temperature record returned by GET /api/temperature-records.
// `category` is the coarse type used by the Temperature Log UI filter;
// `recordType` is the granular value (e.g. "fridge_opening", "cooked_core").
interface TemperatureRecord {
  id: string;
  category: "cooked" | "fridge" | "freezer";
  recordType: string;
  recordedAt: string;
  temperatureC: string;
  userId: number | null;
  userName: string | null;
  planId: number;
  planName: string | null;
  recipeId: number | null;
  recipeName: string | null;
  ingredientId: number | null;
  ingredientName: string | null;
  trayIndex: number | null;
  locationId: number | null;
  locationName: string | null;
}

interface StorageLocationLite {
  id: number;
  name: string;
  zone: "fridge" | "freezer" | "ambient";
}

// Slot value used by the calendar detail view. AM = opening check, PM =
// closing check. A missing slot is a non-completion which we want to flag
// visually.
interface SlotReading {
  temperatureC: number;
  recordedAt: string;
  userName: string | null;
  safe: boolean;
}

const TEMP_THRESHOLDS = {
  fridge: { maxSafe: 8 },
  freezer: { maxSafe: -15 },
} as const;

function isReadingSafe(zone: "fridge" | "freezer", temp: number): boolean {
  if (zone === "fridge") return temp <= TEMP_THRESHOLDS.fridge.maxSafe;
  return temp <= TEMP_THRESHOLDS.freezer.maxSafe;
}

// Calendar-based Temperature Log. Mirrors the production-plan weekly
// calendar so spotting missing readings is glanceable: each fridge/freezer
// gets an AM (opening) and PM (closing) slot per day. Cooked-core readings
// sit in a collapsible section below the day detail.
function TemperatureRecordsTab() {
  const [records, setRecords] = useState<TemperatureRecord[]>([]);
  const [locations, setLocations] = useState<StorageLocationLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [cookedOpen, setCookedOpen] = useState(false);

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekDays = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(weekStart, i));
  const fromStr = format(weekStart, "yyyy-MM-dd");
  const toStr = format(weekEnd, "yyyy-MM-dd");
  const selectedKey = format(selectedDate, "yyyy-MM-dd");

  // Pull the canonical fridge/freezer list once. Records alone aren't enough —
  // if no operator recorded a reading for "Walk-in Fridge" this week, we still
  // want that location to appear in the grid as a missing slot.
  useEffect(() => {
    fetch(`${BASE}/api/storage-locations`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((rows: { id: number; name: string; zone: string }[]) => {
        const filtered = rows
          .filter(l => l.zone === "fridge" || l.zone === "freezer")
          .map(l => ({ id: l.id, name: l.name, zone: l.zone as "fridge" | "freezer" }));
        setLocations(filtered);
      })
      .catch(() => setLocations([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${BASE}/api/temperature-records?from=${fromStr}&to=${toStr}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : r.json().then((d: { error?: string }) => { throw new Error(d.error || "Failed to load"); }))
      .then((data: TemperatureRecord[]) => { setRecords(data); setLoading(false); })
      .catch((err: Error) => { setError(err.message); setLoading(false); });
  }, [fromStr, toStr]);

  function selectDay(day: Date) { setSelectedDate(day); }
  function prevWeek() { setSelectedDate(d => addWeeks(d, -1)); }
  function nextWeek() { setSelectedDate(d => addWeeks(d, 1)); }
  function jumpToDate(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.value) setSelectedDate(new Date(`${e.target.value}T12:00:00`));
  }

  // Pre-compute a per-day, per-location AM/PM index. Map key: `${dayKey}|${locationId}|${slot}`.
  // Slot = "am" (opening) | "pm" (closing). Stored alongside the source record
  // so the detail panel can show time and recorder.
  const slotIndex = new Map<string, SlotReading>();
  for (const r of records) {
    if (r.category !== "fridge" && r.category !== "freezer") continue;
    if (r.locationId == null) continue;
    const slot = r.recordType.endsWith("_closing") ? "pm" : "am";
    const dayKey = format(new Date(r.recordedAt), "yyyy-MM-dd");
    const temp = parseFloat(r.temperatureC);
    slotIndex.set(`${dayKey}|${r.locationId}|${slot}`, {
      temperatureC: temp,
      recordedAt: r.recordedAt,
      userName: r.userName,
      safe: isReadingSafe(r.category, temp),
    });
  }

  // Per-day status: examines all configured fridges/freezers for that day and
  // classifies overall completion. Used to colour the calendar dots.
  function statusForDay(day: Date): "empty" | "complete" | "partial" | "warn" {
    const dayKey = format(day, "yyyy-MM-dd");
    let hasAny = false;
    let missing = 0;
    let warn = 0;
    for (const loc of locations) {
      for (const slot of ["am", "pm"] as const) {
        const r = slotIndex.get(`${dayKey}|${loc.id}|${slot}`);
        if (r) {
          hasAny = true;
          if (!r.safe) warn += 1;
        } else {
          missing += 1;
        }
      }
    }
    if (!hasAny) return "empty";
    if (warn > 0) return "warn";
    if (missing > 0) return "partial";
    return "complete";
  }

  // Cooked-core records for the selected day.
  const cookedToday = records.filter(r => {
    if (r.category !== "cooked") return false;
    return format(new Date(r.recordedAt), "yyyy-MM-dd") === selectedKey;
  });

  if (loading && records.length === 0) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading temperature records…
    </div>
  );
  if (error) return (
    <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400 text-sm">{error}</div>
  );

  const fridges = locations.filter(l => l.zone === "fridge");
  const freezers = locations.filter(l => l.zone === "freezer");

  return (
    <div className="space-y-4">
      {/* Weekly calendar — mirrors the Production Plans calendar style so
          the page feels familiar. */}
      <div className="glass-panel rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={prevWeek} className="p-2 rounded-lg hover:bg-secondary/50 transition-colors" aria-label="Previous week">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-muted-foreground">
              {format(weekStart, "d MMM")} — {format(weekEnd, "d MMM yyyy")}
            </span>
            <label className="relative cursor-pointer flex items-center" title="Jump to date">
              <CalendarIcon className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
              <input
                type="date"
                value={selectedKey}
                onChange={jumpToDate}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </label>
            <button
              onClick={() => setSelectedDate(new Date())}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Today
            </button>
          </div>
          <button onClick={nextWeek} className="p-2 rounded-lg hover:bg-secondary/50 transition-colors" aria-label="Next week">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-2">
          {weekDays.map(day => {
            const status = statusForDay(day);
            const today = isToday(day);
            const selected = isSameDay(day, selectedDate);
            return (
              <button
                key={format(day, "yyyy-MM-dd")}
                onClick={() => selectDay(day)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl py-3 px-1 transition-all border",
                  selected
                    ? "bg-primary text-primary-foreground border-primary shadow-md"
                    : today
                    ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                    : "border-border hover:bg-secondary/50"
                )}
              >
                <span className={cn(
                  "text-xs font-medium uppercase tracking-wide",
                  selected ? "text-primary-foreground/70" : today ? "text-primary" : "text-muted-foreground"
                )}>
                  {format(day, "EEE")}
                </span>
                <span className={cn(
                  "text-lg font-bold leading-none",
                  selected ? "text-primary-foreground" : today ? "text-primary" : "text-foreground"
                )}>
                  {format(day, "d")}
                </span>
                {status === "empty" ? (
                  <span className="h-2" />
                ) : (
                  <span className={cn(
                    "w-2 h-2 rounded-full",
                    selected
                      ? "bg-white/70"
                      : status === "complete"
                      ? "bg-emerald-500"
                      : status === "warn"
                      ? "bg-red-500"
                      : "bg-amber-500"
                  )} />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 pt-1 border-t border-border/50 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> All readings logged & safe
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Some readings missing
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Out-of-range reading
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-border border border-border" /> No readings
          </span>
        </div>
      </div>

      {/* Selected day header */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">
          {isToday(selectedDate) ? "Today" : isYesterday(selectedDate) ? "Yesterday" : format(selectedDate, "EEEE, d MMMM yyyy")}
        </h2>
        <span className="text-sm text-muted-foreground">
          {fridges.length} fridge{fridges.length !== 1 ? "s" : ""} · {freezers.length} freezer{freezers.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Per-day fridge/freezer grid. Each row = one location, two slots = AM/PM. */}
      {locations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No fridges or freezers configured. Add them in Settings → Storage Locations.
        </div>
      ) : (
        <div className="space-y-4">
          {fridges.length > 0 && (
            <LocationSlotGrid
              title="Fridges"
              zone="fridge"
              locations={fridges}
              dayKey={selectedKey}
              slotIndex={slotIndex}
            />
          )}
          {freezers.length > 0 && (
            <LocationSlotGrid
              title="Freezers"
              zone="freezer"
              locations={freezers}
              dayKey={selectedKey}
              slotIndex={slotIndex}
            />
          )}
        </div>
      )}

      {/* Cooked-core readings for the selected day — collapsible, separate
          from the AM/PM grid because they don't fit that mental model. */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setCookedOpen(v => !v)}
          className="w-full px-4 py-2.5 border-b border-border bg-secondary/20 flex items-center gap-2 text-left hover:bg-secondary/40 transition-colors"
          aria-expanded={cookedOpen}
        >
          <Flame className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <h3 className="text-sm font-semibold">Cooked-core readings ({cookedToday.length})</h3>
          {cookedOpen
            ? <ChevronUp className="w-4 h-4 text-muted-foreground ml-auto flex-shrink-0" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground ml-auto flex-shrink-0" />}
        </button>
        {cookedOpen && (
          cookedToday.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No cooked-core readings recorded on this day.</div>
          ) : (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-secondary/40 backdrop-blur-sm">
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Time</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Recipe</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Ingredient</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-muted-foreground">Tray</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-muted-foreground">Temp</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cookedToday.map(rec => {
                    const temp = parseFloat(rec.temperatureC);
                    // Cooked-core has no single safe threshold — it depends on
                    // the raw meat type and cooking setting per recipe. Display
                    // the reading neutrally and let the reviewer judge.
                    return (
                      <tr key={rec.id} className="hover:bg-secondary/10">
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap text-xs">
                          {format(new Date(rec.recordedAt), "HH:mm")}
                        </td>
                        <td className="px-4 py-2.5 font-medium">{rec.recipeName ?? (rec.recipeId ? `Recipe #${rec.recipeId}` : "—")}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{rec.ingredientName ?? "—"}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums">{rec.trayIndex != null ? rec.trayIndex + 1 : "—"}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="font-bold tabular-nums text-foreground">
                            {temp.toFixed(1)}°C
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{rec.userName ?? "Unknown"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// Renders one zone's locations as a 2-column slot grid: AM (Sunrise) and
// PM (Sunset). Missing readings show as a dashed "Not recorded" pill so
// the gap is obvious at a glance.
function LocationSlotGrid({ title, zone, locations, dayKey, slotIndex }: {
  title: string;
  zone: "fridge" | "freezer";
  locations: StorageLocationLite[];
  dayKey: string;
  slotIndex: Map<string, SlotReading>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-secondary/20 flex items-center gap-2">
        <Thermometer className={cn("w-4 h-4 flex-shrink-0", zone === "fridge" ? "text-sky-600" : "text-indigo-600")} />
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground ml-1">{locations.length}</span>
      </div>
      <ul className="divide-y divide-border">
        {locations.map(loc => {
          const am = slotIndex.get(`${dayKey}|${loc.id}|am`);
          const pm = slotIndex.get(`${dayKey}|${loc.id}|pm`);
          return (
            <li key={loc.id} className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_minmax(160px,200px)_minmax(160px,200px)] gap-3 items-center px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{loc.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{loc.zone}</p>
              </div>
              <SlotCell label="AM" icon={<Sunrise className="w-3.5 h-3.5" />} reading={am} zone={zone} />
              <SlotCell label="PM" icon={<Sunset className="w-3.5 h-3.5" />} reading={pm} zone={zone} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SlotCell({ label, icon, reading, zone }: {
  label: string;
  icon: React.ReactNode;
  reading: SlotReading | undefined;
  zone: "fridge" | "freezer";
}) {
  if (!reading) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-secondary/10 px-3 py-2 flex items-center gap-2 text-muted-foreground">
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
          {icon}{label}
        </span>
        <span className="text-xs italic">Not recorded</span>
      </div>
    );
  }
  const safe = reading.safe;
  return (
    <div className={cn(
      "rounded-xl border px-3 py-2 transition-colors",
      safe
        ? zone === "fridge"
          ? "border-sky-200 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/20"
          : "border-indigo-200 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/20"
        : "border-red-300 bg-red-50/70 dark:border-red-800 dark:bg-red-950/30"
    )}>
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}{label}
        <span className="ml-auto tabular-nums normal-case">{format(new Date(reading.recordedAt), "HH:mm")}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 mt-0.5">
        <span className={cn("font-bold tabular-nums text-base", safe ? "text-foreground" : "text-red-700 dark:text-red-300")}>
          {reading.temperatureC.toFixed(1)}°C
        </span>
        <span className="text-[11px] text-muted-foreground truncate" title={reading.userName ?? "Unknown"}>
          {reading.userName ?? "Unknown"}
        </span>
      </div>
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

type BatchWeightRow = {
  id: number;
  planId: number;
  planItemId: number;
  recipeId: number;
  recipeName: string | null;
  recipeColor: string | null;
  recipeCategory: string | null;
  planName: string | null;
  planDate: string | null;
  batchSequence: number;
  trayWeightG: number;
  portionWeightG: number;
  packSize: number;
  targetWeightG: number;
  actualWeightG: number;
  varianceG: number;
  toleranceUnderG: number;
  toleranceOverG: number;
  withinTolerance: boolean;
  isLastBatchOfRecipe: boolean;
  chillEndAt: string | null;
  chilledVia: string | null;
  weighedByName: string | null;
  chilledByName: string | null;
  recordedAt: string;
};

type CoolingRow = {
  planId: number;
  planDate: string | null;
  planName: string | null;
  recipeId: number;
  recipeName: string | null;
  recipeColor: string | null;
  chillStartAt: string;
  chillEndAt: string;
  chilledVia: string | null;
  chilledByName: string | null;
  durationMinutes: number;
};

type VarianceStat = {
  recipeId: number;
  recipeName: string | null;
  recipeColor: string | null;
  count: number;
  mean: number;
  min: number;
  max: number;
  stdev: number;
  withinToleranceCount: number;
};

type BatchWeightsResponse = {
  settings: { trayWeightG: number; chillTargetTempC: number; toleranceUnderG: number; toleranceOverG: number };
  records: BatchWeightRow[];
  cooling: CoolingRow[];
  variance: VarianceStat[];
};

function BatchWeightsTab({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const [data, setData] = useState<BatchWeightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = `${BASE}/api/reports/batch-weights?from=${fromDate}&to=${toDate}`;
    fetch(url, { credentials: "include" })
      .then(r => r.ok ? r.json() as Promise<BatchWeightsResponse> : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { setData(d); setLoading(false); })
      .catch((err: Error) => { setError(err.message); setLoading(false); });
  }, [fromDate, toDate]);

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading batch weights…
    </div>
  );
  if (error) return (
    <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400 text-sm">{error}</div>
  );
  if (!data) return null;

  const recordCount = data.records.length;
  const coolingCount = data.cooling.length;
  const avgChillMinutes = coolingCount > 0
    ? Math.round(data.cooling.reduce((s, c) => s + c.durationMinutes, 0) / coolingCount)
    : 0;
  const outOfToleranceCount = data.records.filter(r => !r.withinTolerance).length;
  const tolActive = data.settings.toleranceUnderG > 0 || data.settings.toleranceOverG > 0;

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="rounded-xl border border-cyan-200 dark:border-cyan-800 bg-cyan-50/50 dark:bg-cyan-950/20 px-4 py-3 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-cyan-600 dark:text-cyan-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-cyan-900 dark:text-cyan-200">
          <p className="font-semibold">HACCP Cooling & Pack Weights</p>
          <p className="text-xs mt-0.5">
            Target chill temp <strong>{data.settings.chillTargetTempC}°C</strong> ·
            tray weight <strong>{data.settings.trayWeightG}g</strong> ·
            tolerance <strong>−{data.settings.toleranceUnderG}g / +{data.settings.toleranceOverG}g</strong>
          </p>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Batches weighed</p>
          <p className="text-2xl font-bold tabular-nums">{recordCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Chill cycles logged</p>
          <p className="text-2xl font-bold tabular-nums">{coolingCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg chill time</p>
          <p className="text-2xl font-bold tabular-nums">{avgChillMinutes} <span className="text-sm font-normal text-muted-foreground">min</span></p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Out of tolerance</p>
          <p className={cn("text-2xl font-bold tabular-nums", outOfToleranceCount > 0 && tolActive ? "text-amber-600 dark:text-amber-400" : "")}>
            {tolActive ? outOfToleranceCount : "—"}
          </p>
        </div>
      </div>

      {/* Cooling durations */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Hourglass className="w-4 h-4 text-cyan-500" />
          <h3 className="font-semibold text-base">Cooling Durations</h3>
          <span className="text-xs text-muted-foreground">({coolingCount} cycle{coolingCount === 1 ? "" : "s"})</span>
        </div>
        {coolingCount === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">No completed chill cycles in this range.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Recipe</th>
                  <th className="px-4 py-2 text-left font-medium">Chill start</th>
                  <th className="px-4 py-2 text-left font-medium">Chill end</th>
                  <th className="px-4 py-2 text-right font-medium">Duration</th>
                  <th className="px-4 py-2 text-left font-medium">Marked by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.cooling.map((c, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">{c.planDate ?? "—"}</td>
                    <td className="px-4 py-2 font-medium" style={c.recipeColor ? { color: c.recipeColor } : undefined}>{c.recipeName ?? `Recipe #${c.recipeId}`}</td>
                    <td className="px-4 py-2 tabular-nums">{new Date(c.chillStartAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-2 tabular-nums">{new Date(c.chillEndAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{c.durationMinutes} min</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">
                      {c.chilledByName ?? "—"}
                      {c.chilledVia && <span className="ml-1 opacity-70">({c.chilledVia.replace(/_/g, " ")})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Variance per recipe */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-base">Weight Variance by Recipe</h3>
        </div>
        {data.variance.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">No weight records in this range.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Recipe</th>
                  <th className="px-4 py-2 text-right font-medium">Batches</th>
                  <th className="px-4 py-2 text-right font-medium">Mean var (g)</th>
                  <th className="px-4 py-2 text-right font-medium">Min (g)</th>
                  <th className="px-4 py-2 text-right font-medium">Max (g)</th>
                  <th className="px-4 py-2 text-right font-medium">σ (g)</th>
                  {tolActive && <th className="px-4 py-2 text-right font-medium">In tol.</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.variance.map((v) => (
                  <tr key={v.recipeId}>
                    <td className="px-4 py-2 font-medium" style={v.recipeColor ? { color: v.recipeColor } : undefined}>{v.recipeName ?? `Recipe #${v.recipeId}`}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{v.count}</td>
                    <td className={cn("px-4 py-2 text-right tabular-nums font-semibold", v.mean > 0 ? "text-emerald-600 dark:text-emerald-400" : v.mean < 0 ? "text-amber-600 dark:text-amber-400" : "")}>
                      {v.mean > 0 ? "+" : ""}{v.mean.toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{v.min.toFixed(0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{v.max.toFixed(0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{v.stdev.toFixed(1)}</td>
                    {tolActive && (
                      <td className="px-4 py-2 text-right tabular-nums text-xs">
                        {v.withinToleranceCount}/{v.count}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Raw record list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-base">Batch Weight Log</h3>
          <span className="text-xs text-muted-foreground">({recordCount} batches)</span>
        </div>
        {recordCount === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">No batch weight records in this range.</div>
        ) : (
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-muted-foreground text-xs sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Time</th>
                  <th className="px-4 py-2 text-left font-medium">Recipe</th>
                  <th className="px-4 py-2 text-right font-medium">Batch</th>
                  <th className="px-4 py-2 text-right font-medium">Target (g)</th>
                  <th className="px-4 py-2 text-right font-medium">Actual (g)</th>
                  <th className="px-4 py-2 text-right font-medium">Variance</th>
                  <th className="px-4 py-2 text-left font-medium">Weighed by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.records.map((r) => (
                  <tr key={r.id} className={r.isLastBatchOfRecipe ? "bg-cyan-50/30 dark:bg-cyan-950/10" : ""}>
                    <td className="px-4 py-1.5 tabular-nums text-muted-foreground">{r.planDate ?? "—"}</td>
                    <td className="px-4 py-1.5 tabular-nums">{new Date(r.recordedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-1.5 font-medium" style={r.recipeColor ? { color: r.recipeColor } : undefined}>
                      {r.recipeName ?? `Recipe #${r.recipeId}`}
                      {r.isLastBatchOfRecipe && <span className="ml-1.5 text-[10px] uppercase text-cyan-600 dark:text-cyan-400 font-bold">final</span>}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{r.batchSequence}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{r.targetWeightG}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums font-semibold">{r.actualWeightG}</td>
                    <td className={cn(
                      "px-4 py-1.5 text-right tabular-nums",
                      tolActive && !r.withinTolerance ? "text-amber-600 dark:text-amber-400 font-semibold" : ""
                    )}>
                      {r.varianceG > 0 ? "+" : ""}{r.varianceG}
                    </td>
                    <td className="px-4 py-1.5 text-xs text-muted-foreground">{r.weighedByName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function HaccpTab({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const [checklists, setChecklists] = useState<HaccpChecklistRow[]>([]);
  const [missing, setMissing] = useState<HaccpMissingRow[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters — temperatures moved to their own HACCP sub-tab, so this view
  // only deals with checklist completions and outstanding items.
  const [stationFilter, setStationFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "checklists" | "outstanding">("all");
  const [categoryFilter, setCategoryFilter] = useState<"" | HaccpChecklistRow["category"]>("");

  // Collapsible sections — outstanding open by default so the page surfaces
  // gaps; completed list defaults closed so the page is glanceable.
  const [outstandingOpen, setOutstandingOpen] = useState(true);
  const [completedOpen, setCompletedOpen] = useState(false);

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

    // The /missing endpoint does not take userId (un-done items have no
    // user), but it does honour stationType.
    const missingParams = new URLSearchParams({ from: fromDate, to: toDate });
    if (stationFilter) missingParams.set("stationType", stationFilter);
    const missingUrl = `${BASE}/api/checklists/missing?${missingParams.toString()}`;

    Promise.all([
      fetch(checklistUrl, { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch(missingUrl, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ])
      .then(([c, m]: [HaccpChecklistRow[], HaccpMissingRow[]]) => {
        setChecklists(c);
        setMissing(m);
        setLoading(false);
      })
      .catch((err: Error) => { setError(err.message); setLoading(false); });
  }, [fromDate, toDate, stationFilter, userFilter]);

  const filteredChecklists = checklists.filter(c => {
    if (categoryFilter && c.category !== categoryFilter) return false;
    return true;
  });

  const filteredMissing = missing.filter(m => {
    if (categoryFilter && m.category !== categoryFilter) return false;
    return true;
  });

  const uniqueCheckUsers = new Set(filteredChecklists.map(c => c.completedByName ?? "").filter(Boolean)).size;
  const uniqueStations = new Set(filteredChecklists.map(c => c.stationType)).size;

  const showChecks = kindFilter === "all" || kindFilter === "checklists";
  const showMissing = kindFilter === "all" || kindFilter === "outstanding";
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
            Daily opening/cleaning/closing checks for EHO inspections. Temperature readings have moved to
            the Temperature Log sub-tab. Use the filters below to narrow by date, station, or team member.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SummaryCard icon={<ClipboardCheck className="w-4 h-4 text-emerald-600" />} label="Checks Completed" value={String(filteredChecklists.length)} sub={`${uniqueCheckUsers} team member${uniqueCheckUsers !== 1 ? "s" : ""}, ${uniqueStations} station${uniqueStations !== 1 ? "s" : ""}`} />
        <SummaryCard
          icon={<AlertTriangle className={cn("w-4 h-4", filteredMissing.length > 0 ? "text-red-500" : "text-muted-foreground")} />}
          label="Outstanding Checks"
          value={String(filteredMissing.length)}
          sub={filteredMissing.length > 0 ? "Expected but not completed" : "All checks accounted for"}
          highlight={filteredMissing.length > 0 ? "red" : undefined}
        />
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
      } else {
        toast({ title: "Failed to post comment", description: `Server returned ${res.status}`, variant: "destructive" });
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
  entries: { planDate: string; grams: number; comment: string | null }[];
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
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 py-2">
                        {recipe.entries.map((entry, i) => (
                          <div key={i} className="text-xs bg-card border border-border rounded-lg px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-muted-foreground">{format(new Date(entry.planDate + "T00:00:00"), "d MMM")}</p>
                              <p className={cn("font-bold", entry.grams === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>{entry.grams}g</p>
                            </div>
                            {entry.comment && (
                              <p className="mt-1 text-muted-foreground italic break-words leading-snug">{entry.comment}</p>
                            )}
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

// ─── Risk Assessments Tab ────────────────────────────────────────────────────
// Unified compliance to-do list + document repository. Overdue / due / upcoming
// counts at the top, per-assessment detail drill-down, one-click complete with
// auto-scheduled recurrence, and print-ready reports for EHO / SALSA audits.

interface RiskAssessmentRecord {
  id: number;
  // Free-text category. Known: fire | food_safety | general_safety |
  // insurance | certification | licence | sop | other.
  assessmentType: string;
  title: string;
  bodyMarkdown: string;
  status: "draft" | "active" | "archived" | string;
  reviewFrequencyMonths: number;
  lastReviewedAt: string | null;
  nextReviewDue: string | null;
  lastReviewedByName: string | null;
  reviewerQualifications: string | null;
  fileMime: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  fileVersion: string | null;
  fileUploadedAt: string | null;
  originalIssueDate: string | null;
  createdAt: string;
  updatedAt: string;
  openCount?: number;
  overdueCount?: number;
}

interface ComplianceActionRecord {
  id: number;
  riskAssessmentId: number | null;
  title: string;
  description: string | null;
  category: string;
  priority: "low" | "medium" | "high" | "critical" | string;
  status: "open" | "in_progress" | "completed" | "not_applicable" | string;
  assignedToUserId: number | null;
  assignedToName: string | null;
  dueDate: string | null;
  recurrence: string;
  parentActionId: number | null;
  completedAt: string | null;
  completedByName: string | null;
  completionNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ComplianceDashboard {
  counts: { overdue: number; dueThisWeek: number; upcoming: number; unscheduled: number };
  overdue: ComplianceActionRecord[];
  dueThisWeek: ComplianceActionRecord[];
  upcoming: ComplianceActionRecord[];
  unscheduled: ComplianceActionRecord[];
  assessments: RiskAssessmentRecord[];
}

const RECURRENCE_LABEL: Record<string, string> = {
  none: "One-off",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  six_monthly: "6-monthly",
  annually: "Annually",
  three_yearly: "3-yearly",
  five_yearly: "5-yearly",
};

const PRIORITY_COLOUR: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-300 dark:border-red-700",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-300 dark:border-orange-700",
  medium: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400 border-slate-200 dark:border-slate-800",
};

const CATEGORY_ICON: Record<string, typeof TrendingUp> = {
  fire: Flame,
  food_safety: ShieldCheck,
  general: HardHat,
  general_safety: HardHat,
  electrical: Zap,
  gas: Flame,
  training: Users,
  other: ClipboardList,
  finance: PoundSterling,
  insurance: ShieldCheck,
  certification: ShieldCheck,
  licence: ClipboardList,
  sop: ClipboardList,
};

function assessmentTypeLabel(t: string): string {
  switch (t) {
    case "fire": return "Fire";
    case "food_safety": return "Food Safety";
    case "general_safety": return "Health & Safety";
    case "insurance": return "Insurance";
    case "certification": return "Certification";
    case "licence": return "Licence";
    case "sop": return "SOP";
    default: return t.charAt(0).toUpperCase() + t.slice(1);
  }
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDueLabel(dueDate: string | null): { text: string; tone: "red" | "amber" | "slate" | "green" } {
  if (!dueDate) return { text: "No due date", tone: "slate" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { text: `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"}`, tone: "red" };
  if (diffDays === 0) return { text: "Due today", tone: "amber" };
  if (diffDays === 1) return { text: "Due tomorrow", tone: "amber" };
  if (diffDays <= 7) return { text: `Due in ${diffDays} days`, tone: "amber" };
  return { text: format(due, "d MMM yyyy"), tone: "slate" };
}

function RiskAssessmentsTab({ userRole, currentUserName }: { userRole: string; currentUserName: string | null }) {
  const [dashboard, setDashboard] = useState<ComplianceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<number | null>(null);
  const [completingAction, setCompletingAction] = useState<ComplianceActionRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const isAdmin = userRole === "admin";

  const reloadDashboard = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${BASE}/api/compliance-actions/dashboard`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error("Failed to load compliance dashboard"); return r.json(); })
      .then((d: ComplianceDashboard) => { setDashboard(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [refreshKey]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (error) return <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-red-600 dark:text-red-400">{error}</div>;
  if (!dashboard) return null;

  // Detail view
  if (selectedAssessmentId != null) {
    return (
      <RiskAssessmentDetail
        id={selectedAssessmentId}
        userRole={userRole}
        currentUserName={currentUserName}
        onBack={() => { setSelectedAssessmentId(null); reloadDashboard(); }}
        onRequestComplete={(a) => setCompletingAction(a)}
        externalRefreshKey={refreshKey}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary pills */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryPill label="Overdue" count={dashboard.counts.overdue} tone="red" />
        <SummaryPill label="Due this week" count={dashboard.counts.dueThisWeek} tone="amber" />
        <SummaryPill label="Upcoming (30d)" count={dashboard.counts.upcoming} tone="slate" />
        <SummaryPill label="No due date" count={dashboard.counts.unscheduled} tone="slate" />
      </div>

      {/* Overdue */}
      {dashboard.overdue.length > 0 && (
        <ActionSection
          title="Overdue"
          tone="red"
          actions={dashboard.overdue}
          onComplete={(a) => setCompletingAction(a)}
        />
      )}

      {/* Due this week */}
      {dashboard.dueThisWeek.length > 0 && (
        <ActionSection
          title="Due this week"
          tone="amber"
          actions={dashboard.dueThisWeek}
          onComplete={(a) => setCompletingAction(a)}
        />
      )}

      {/* Upcoming (30 days) */}
      {dashboard.upcoming.length > 0 && (
        <ActionSection
          title="Upcoming (next 30 days)"
          tone="slate"
          actions={dashboard.upcoming}
          onComplete={(a) => setCompletingAction(a)}
          collapsed
        />
      )}

      {dashboard.overdue.length === 0 && dashboard.dueThisWeek.length === 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-6 text-center">
          <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
          <p className="font-semibold text-emerald-700 dark:text-emerald-400">All compliance tasks on track</p>
          <p className="text-sm text-emerald-600/80 dark:text-emerald-400/80 mt-1">Nothing overdue or due this week.</p>
        </div>
      )}

      {/* Documents list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg">Documents</h3>
          {isAdmin && (
            <button
              onClick={() => alert("Use the existing detail view to upload a PDF onto a record. New-record creation flow coming next.")}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" /> New Document
            </button>
          )}
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {dashboard.assessments.map((ra) => {
            const Icon = CATEGORY_ICON[ra.assessmentType] ?? ClipboardList;
            const hasFile = ra.fileSizeBytes != null && ra.fileSizeBytes > 0;
            return (
              <div
                key={ra.id}
                className="text-left bg-card border border-border rounded-xl p-4 hover:border-primary/50 hover:shadow-sm transition-all"
              >
                <button
                  type="button"
                  onClick={() => setSelectedAssessmentId(ra.id)}
                  className="w-full text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{ra.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {assessmentTypeLabel(ra.assessmentType)}
                          {" · "}
                          {ra.status === "draft" ? "Draft" : ra.status === "active" ? "Active" : "Archived"}
                          {hasFile && ` · PDF ${formatFileSize(ra.fileSizeBytes)}`}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                  </div>
                  <div className="flex items-center gap-3 mt-3 text-xs">
                    <span className="text-muted-foreground">{ra.openCount ?? 0} open</span>
                    {(ra.overdueCount ?? 0) > 0 && (
                      <span className="text-red-600 dark:text-red-400 font-semibold">
                        {ra.overdueCount} overdue
                      </span>
                    )}
                    {ra.nextReviewDue && (
                      <span className="text-muted-foreground ml-auto">
                        Review due {format(new Date(ra.nextReviewDue + "T00:00:00"), "d MMM yyyy")}
                      </span>
                    )}
                  </div>
                </button>
                {hasFile && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                    <a
                      href={`${BASE}/api/risk-assessments/${ra.id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center text-xs px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors"
                    >
                      View PDF
                    </a>
                    <a
                      href={`${BASE}/api/risk-assessments/${ra.id}/file?download=1`}
                      className="flex-1 text-center text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Download
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Complete dialog */}
      {completingAction && (
        <CompleteActionDialog
          action={completingAction}
          defaultCompletedBy={currentUserName ?? ""}
          onClose={() => setCompletingAction(null)}
          onCompleted={() => { setCompletingAction(null); reloadDashboard(); }}
        />
      )}
    </div>
  );
}

// Library of printables / downloadables. Each is a React route rendering
// a print-optimised page; the user opens in a new tab and uses the browser
// print dialog to print directly or save as PDF.
const PRINTABLES: { title: string; description: string; href: string; category: "fire" | "food_safety" | "general" | "finance"; note?: string }[] = [
  {
    title: "Recipe Profit & Loss Report",
    description: "Per-recipe cost breakdown: ingredient + packaging + labour costs, RRP, and gross margin. Filter by category, core-menu, or priced-only. Landscape A4, colour-coded rows.",
    href: "/print/recipe-pnl",
    category: "finance",
    note: "Open → pick filters → Print / Save as PDF",
  },
  {
    title: "Fire Action Notice",
    description: "A4 wall poster — mount next to each Manual Call Point and at the muster point. Laminate for durability.",
    href: "/print/fire-action-notice",
    category: "fire",
    note: "Print A4 portrait · laminate · mount ×5 (one per MCP + muster point)",
  },
  {
    title: "Fire Safety Equipment Audit",
    description: "Walk-round audit sheet for a team member — what extinguishers / MCPs / fire exits you should have, where, and tick-boxes for Present / Serviced / Notes. Includes marker map of the building.",
    href: "/print/fire-safety-equipment-audit",
    category: "fire",
    note: "Print ~3 A4 pages · hand to Fire Warden · file completed copy in the Fire Log Book",
  },
];

function PrintablesTab() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold mb-1">Printables & Reports</h2>
        <p className="text-sm text-muted-foreground">
          Open any item in a new tab, then use the browser print dialog (Cmd/Ctrl + P)
          to print directly or save as PDF.
        </p>
      </div>
      <ResourcesSection />
    </div>
  );
}

function ResourcesSection() {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-lg">Resources — Printables</h3>
        <span className="text-xs text-muted-foreground">Open → print from browser → laminate</span>
      </div>
      <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
        {PRINTABLES.map(p => {
          const Icon = CATEGORY_ICON[p.category] ?? FileText;
          return (
            <a
              key={p.href}
              href={`${BASE}${p.href}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors"
            >
              <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm">{p.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                {p.note && <p className="text-[11px] text-muted-foreground mt-1 italic">{p.note}</p>}
              </div>
              <Printer className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
            </a>
          );
        })}
      </div>
    </div>
  );
}

function SummaryPill({ label, count, tone }: { label: string; count: number; tone: "red" | "amber" | "slate" }) {
  const colour = tone === "red"
    ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400"
    : tone === "amber"
      ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400"
      : "bg-card border-border text-foreground";
  return (
    <div className={cn("border rounded-xl px-4 py-3", colour)}>
      <p className="text-2xl font-bold tabular-nums">{count}</p>
      <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
    </div>
  );
}

function ActionSection({
  title, tone, actions, onComplete, collapsed = false,
}: {
  title: string;
  tone: "red" | "amber" | "slate";
  actions: ComplianceActionRecord[];
  onComplete: (a: ComplianceActionRecord) => void;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  const ring = tone === "red" ? "border-red-200 dark:border-red-800" : tone === "amber" ? "border-amber-200 dark:border-amber-800" : "border-border";
  return (
    <div className={cn("bg-card border rounded-xl overflow-hidden", ring)}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/30 transition-colors">
        <div className="flex items-center gap-2">
          <h3 className="font-bold">{title}</h3>
          <span className="text-sm text-muted-foreground">({actions.length})</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="divide-y divide-border">
          {actions.map(a => <ActionRow key={a.id} action={a} onComplete={onComplete} />)}
        </div>
      )}
    </div>
  );
}

function ActionRow({ action, onComplete }: { action: ComplianceActionRecord; onComplete: (a: ComplianceActionRecord) => void }) {
  const dueLabel = formatDueLabel(action.dueDate);
  const Icon = CATEGORY_ICON[action.category] ?? ClipboardList;
  const toneClass = dueLabel.tone === "red"
    ? "text-red-600 dark:text-red-400"
    : dueLabel.tone === "amber"
      ? "text-amber-700 dark:text-amber-400"
      : "text-muted-foreground";
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{action.title}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs">
          <span className={cn("font-semibold", toneClass)}>{dueLabel.text}</span>
          {action.assignedToName && (
            <span className="text-muted-foreground">· {action.assignedToName}</span>
          )}
          <span className={cn("px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide", PRIORITY_COLOUR[action.priority] ?? "")}>
            {action.priority}
          </span>
          {action.recurrence !== "none" && (
            <span className="text-muted-foreground">· {RECURRENCE_LABEL[action.recurrence] ?? action.recurrence}</span>
          )}
        </div>
        {action.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{action.description}</p>
        )}
      </div>
      <button
        onClick={() => onComplete(action)}
        className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors"
      >
        <Check className="w-3.5 h-3.5" /> Done
      </button>
    </div>
  );
}

function CompleteActionDialog({
  action, defaultCompletedBy, onClose, onCompleted,
}: {
  action: ComplianceActionRecord;
  defaultCompletedBy: string;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [completedBy, setCompletedBy] = useState(defaultCompletedBy);
  const [completedAt, setCompletedAt] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`${BASE}/api/compliance-actions/${action.id}/complete`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: notes.trim() || null,
          completedAt: new Date(completedAt).toISOString(),
          completedByName: completedBy.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? "Failed to mark complete");
      }
      toast({ title: "Marked complete", description: action.recurrence !== "none" ? `Next ${RECURRENCE_LABEL[action.recurrence]?.toLowerCase()} check scheduled.` : undefined });
      onCompleted();
    } catch (e: any) {
      setErr(e.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark complete</DialogTitle>
          <DialogDescription className="text-sm">{action.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Completed by</label>
            <input
              type="text"
              value={completedBy}
              onChange={e => setCompletedBy(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">When</label>
            <input
              type="datetime-local"
              value={completedAt}
              onChange={e => setCompletedAt(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="e.g. All sounders tested OK; Zone 2 slightly quieter — asked installer to review."
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground resize-none"
            />
          </div>
          {action.recurrence !== "none" && (
            <p className="text-xs text-muted-foreground bg-secondary/30 px-3 py-2 rounded-lg">
              This is a <strong>{RECURRENCE_LABEL[action.recurrence]?.toLowerCase()}</strong> task. Marking it done will automatically schedule the next one.
            </p>
          )}
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-secondary/50">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving || !completedBy.trim()}
            className="px-4 py-2 text-sm bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Mark complete"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DocumentFileSection({
  ra, isAdmin, onChanged,
}: {
  ra: RiskAssessmentRecord;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasFile = ra.fileSizeBytes != null && ra.fileSizeBytes > 0;

  const handleSelectFile = () => fileInputRef.current?.click();

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setError("File too large — 15MB max."); return; }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE}/api/risk-assessments/${ra.id}/file`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }
      onChanged();
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm("Remove the attached PDF? The document record itself will remain.")) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/risk-assessments/${ra.id}/file`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Remove failed");
      onChanged();
    } catch (err: any) {
      setError(err.message || "Remove failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            {hasFile ? (
              <>
                <p className="font-semibold truncate">{ra.fileName ?? "Document.pdf"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  PDF · {formatFileSize(ra.fileSizeBytes)}
                  {ra.fileVersion && ` · v${ra.fileVersion}`}
                  {ra.fileUploadedAt && ` · uploaded ${format(new Date(ra.fileUploadedAt), "d MMM yyyy")}`}
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">No PDF attached</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isAdmin ? "Upload a PDF to make this document downloadable." : "Ask an admin to upload the PDF."}
                </p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasFile && (
            <>
              <a
                href={`${BASE}/api/risk-assessments/${ra.id}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm"
              >
                View
              </a>
              <a
                href={`${BASE}/api/risk-assessments/${ra.id}/file?download=1`}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-sm"
              >
                Download
              </a>
            </>
          )}
          {isAdmin && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileChosen}
                className="hidden"
              />
              <button
                type="button"
                onClick={handleSelectFile}
                disabled={uploading}
                className="px-3 py-1.5 rounded-md border border-border hover:bg-secondary/50 text-sm disabled:opacity-50"
              >
                {uploading ? "Uploading…" : hasFile ? "Replace" : "Upload PDF"}
              </button>
              {hasFile && (
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={uploading}
                  className="px-3 py-1.5 rounded-md border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}
    </div>
  );
}

function RiskAssessmentDetail({
  id, userRole, currentUserName, onBack, onRequestComplete, externalRefreshKey,
}: {
  id: number;
  userRole: string;
  currentUserName: string | null;
  onBack: () => void;
  onRequestComplete: (a: ComplianceActionRecord) => void;
  externalRefreshKey: number;
}) {
  const [ra, setRa] = useState<(RiskAssessmentRecord & { actions: ComplianceActionRecord[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const isAdmin = userRole === "admin";

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(`${BASE}/api/risk-assessments/${id}`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error("Failed to load"); return r.json(); })
      .then((d) => { setRa(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [id, refresh, externalRefreshKey]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (error || !ra) return <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-red-600 dark:text-red-400">{error ?? "Not found"}</div>;

  const Icon = CATEGORY_ICON[ra.assessmentType] ?? ClipboardList;

  const openActions = ra.actions.filter(a => a.status === "open" || a.status === "in_progress");
  const completedActions = ra.actions.filter(a => a.status === "completed");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="p-2 -ml-2 hover:bg-secondary/50 rounded-lg transition-colors">
          <ChevronRight className="w-5 h-5 rotate-180" />
        </button>
        <Icon className="w-6 h-6 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold">{ra.title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {assessmentTypeLabel(ra.assessmentType)} · {ra.status}
            {ra.lastReviewedAt && <> · Last reviewed {format(new Date(ra.lastReviewedAt), "d MMM yyyy")}</>}
            {ra.nextReviewDue && <> · Review due {format(new Date(ra.nextReviewDue + "T00:00:00"), "d MMM yyyy")}</>}
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 transition-colors"
            >
              <Pencil className="w-4 h-4" /> Edit
            </button>
          )}
        </div>
      </div>

      {/* Attached PDF + admin upload/replace */}
      <DocumentFileSection
        ra={ra}
        isAdmin={isAdmin}
        onChanged={() => setRefresh(r => r + 1)}
      />

      {/* Body markdown — rendered as plain-text with line wrapping; no markdown lib yet */}
      {ra.bodyMarkdown && (
        <div className="bg-card border border-border rounded-xl p-5">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{ra.bodyMarkdown}</pre>
        </div>
      )}

      {/* Action plan */}
      <div>
        <h3 className="font-bold text-lg mb-3">Action plan ({openActions.length} open)</h3>
        {openActions.length === 0 ? (
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle className="w-5 h-5 inline mr-2" /> No open actions for this assessment.
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
            {openActions.map(a => (
              <ActionRow key={a.id} action={a} onComplete={onRequestComplete} />
            ))}
          </div>
        )}
      </div>

      {/* Completed history */}
      {completedActions.length > 0 && (
        <details className="bg-card border border-border rounded-xl">
          <summary className="cursor-pointer px-4 py-3 font-semibold text-sm hover:bg-secondary/30">
            Recently completed ({completedActions.length})
          </summary>
          <div className="divide-y divide-border">
            {completedActions.slice(0, 20).map(a => (
              <div key={a.id} className="px-4 py-3 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.completedAt && format(new Date(a.completedAt), "d MMM yyyy, HH:mm")}
                      {a.completedByName && ` · ${a.completedByName}`}
                    </p>
                    {a.completionNotes && <p className="text-xs italic text-muted-foreground mt-1">"{a.completionNotes}"</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {editing && isAdmin && (
        <EditRiskAssessmentDialog
          ra={ra}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setRefresh(r => r + 1); }}
        />
      )}
    </div>
  );
}

function EditRiskAssessmentDialog({
  ra, onClose, onSaved,
}: {
  ra: RiskAssessmentRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(ra.title);
  const [body, setBody] = useState(ra.bodyMarkdown);
  const [status, setStatus] = useState(ra.status);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`${BASE}/api/risk-assessments/${ra.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, bodyMarkdown: body, status }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? "Failed to save");
      }
      toast({ title: "Saved" });
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit risk assessment</DialogTitle>
          <DialogDescription className="text-xs">
            Paste the full content from the draft markdown file into the body. Plain text and markdown both render.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Status</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Body (markdown)</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={20}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground font-mono text-xs resize-y"
            />
          </div>
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-secondary/50">Cancel</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} className="px-4 py-2 text-sm bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
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
      } else {
        toast({ title: "Failed to post comment", description: `Server returned ${res.status}`, variant: "destructive" });
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

  async function changePriority(id: number, severity: "green" | "yellow" | "red") {
    try {
      const res = await fetch(`${BASE}/api/andon/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ severity }),
      });
      if (!res.ok) {
        toast({ title: "Failed to update priority", variant: "destructive" });
        return;
      }
      const updated: AndonIssueRecord = await res.json();
      setIssues(prev => prev.map(i => i.id === id ? { ...i, severity: updated.severity } : i));
    } catch (err) {
      console.warn("[Reports] Failed to update priority:", err);
      toast({ title: "Failed to update priority", variant: "destructive" });
    }
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
          <option value="">All Priorities</option>
          <option value="red">Red (Serious)</option>
          <option value="yellow">Yellow (Minor)</option>
          <option value="green">Green (Wish List)</option>
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
                <th className="px-4 py-3 font-medium text-left">Priority</th>
                {isManager && <th className="px-4 py-3 font-medium text-center">Actions</th>}
                <th className="px-4 py-3 font-medium text-left">Station</th>
                <th className="px-4 py-3 font-medium text-left">Description</th>
                <th className="px-4 py-3 font-medium text-left">Reported by</th>
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
                      issue.severity === "red"
                        ? "text-red-600 dark:text-red-400"
                        : issue.severity === "green"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-yellow-600 dark:text-yellow-400"
                    )}>
                      <span className={cn(
                        "w-2 h-2 rounded-full",
                        issue.severity === "red" ? "bg-red-500" : issue.severity === "green" ? "bg-emerald-500" : "bg-yellow-400"
                      )} />
                      {issue.severity === "red" ? "Serious" : issue.severity === "green" ? "Wish List" : "Minor"}
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
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {STATION_LABELS_REPORT[issue.station] ?? issue.station}
                  </td>
                  <td className="px-4 py-3 text-foreground font-semibold w-full">
                    <span className="whitespace-pre-wrap">{issue.description ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-foreground">{issue.reportedByName ?? "—"}</div>
                    {issue.createdAt && (
                      <div className="text-xs text-muted-foreground">
                        {(() => {
                          const d = new Date(issue.createdAt);
                          const time = format(d, "HH:mm");
                          if (isToday(d)) return `at ${time} today`;
                          if (isYesterday(d)) return `at ${time} yesterday`;
                          if (differenceInCalendarDays(new Date(), d) < 7) return `at ${time} ${format(d, "EEEE")}`;
                          return `at ${time} on ${format(d, "d MMM")}`;
                        })()}
                      </div>
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
                      : selectedIssue.severity === "green"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                  )}>
                    <span className={cn(
                      "w-2 h-2 rounded-full",
                      selectedIssue.severity === "red" ? "bg-red-500" : selectedIssue.severity === "green" ? "bg-emerald-500" : "bg-yellow-400"
                    )} />
                    {selectedIssue.severity === "red" ? "Serious" : selectedIssue.severity === "green" ? "Wish List" : "Minor"}
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

                {/* Manager: change priority */}
                {isManager && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Change priority:</span>
                    {(["red", "yellow", "green"] as const).map(s => {
                      const active = selectedIssue.severity === s;
                      const styles = s === "red"
                        ? (active
                            ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"
                            : "border-border text-muted-foreground hover:border-red-300")
                        : s === "green"
                          ? (active
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                              : "border-border text-muted-foreground hover:border-emerald-300")
                          : (active
                              ? "border-yellow-400 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300"
                              : "border-border text-muted-foreground hover:border-yellow-300");
                      const label = s === "red" ? "Serious" : s === "green" ? "Wish List" : "Minor";
                      const dotClass = s === "red" ? "bg-red-500" : s === "green" ? "bg-emerald-500" : "bg-yellow-400";
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => !active && changePriority(selectedIssue.id, s)}
                          disabled={active}
                          className={cn("flex items-center gap-1.5 text-xs px-2.5 py-1 border-2 rounded-lg transition-all", styles, active && "cursor-default")}
                        >
                          <span className={cn("w-2 h-2 rounded-full", dotClass)} />
                          {label}
                        </button>
                      );
                    })}
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
  totalAbsent: number;
  shiftTypeCounts: Record<string, number>;
  absenceAccountCounts: Record<string, number>;
}

interface AttendanceResponse {
  available: boolean;
  from: string;
  to: string;
  rows: EmployeeAttendanceRow[];
  unmatchedAppUsers: Array<{ userId: number; name: string; email: string }>;
  unmatchedPlandayEmployees?: Array<{ plandayEmployeeId: number; name: string; email: string | null }>;
  shiftTypeNames: string[];
  absenceAccountNames: string[];
  activeShiftTypeNames: string[];
  activeAbsenceAccountNames: string[];
  shiftTypeIsUnpaid?: Record<string, boolean>;
}

function UnmatchedPlandayRow({ employee }: { employee: { plandayEmployeeId: number; name: string; email: string | null } }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [role, setRole] = useState<"viewer" | "manager" | "admin">("viewer");

  const invite = async () => {
    if (!employee.email) {
      toast({ title: "No email on Plan Day", description: "Add an email in Plan Day first, or create the user manually in Settings.", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const resp = await fetch(`${BASE}/api/auth/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: employee.email, role }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${resp.status}`);
      }
      setSent(true);
      toast({ title: "Invite sent", description: `${employee.name} will get an email with a sign-up link. Their Plan Day record auto-links when they accept.` });
    } catch (err) {
      toast({ title: "Failed to send invite", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-background rounded-lg px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{employee.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {employee.email ?? <span className="text-amber-600">no email on Plan Day</span>}
        </div>
      </div>
      {!sent && (
        <select
          value={role}
          onChange={e => setRole(e.target.value as "viewer" | "manager" | "admin")}
          disabled={sending}
          className="text-xs px-2 py-1 rounded-md bg-background border border-border"
        >
          <option value="viewer">Viewer</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
      )}
      <button
        onClick={invite}
        disabled={sending || sent || !employee.email}
        className={cn(
          "text-xs px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap",
          sent
            ? "bg-emerald-50 border-emerald-300 text-emerald-700"
            : "bg-primary text-primary-foreground border-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed",
        )}
      >
        {sent ? "Invite sent" : sending ? "Sending…" : "Invite to planner"}
      </button>
    </div>
  );
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
      absent: acc.absent + r.totalAbsent,
    }),
    { total: 0, late: 0, absent: 0 },
  );

  const activeShiftTypes = data.activeShiftTypeNames ?? [];
  const activeAbsenceAccounts = data.activeAbsenceAccountNames ?? [];
  const unpaidMap = data.shiftTypeIsUnpaid ?? {};

  // Plan Day's default paid holiday account is labelled "Standard Hourly
  // Accrual" which isn't what anyone calls it in practice. Rename at the
  // display layer only so the underlying Plan Day data stays untouched.
  const displayAbsenceAccountName = (name: string) =>
    name.toLowerCase().includes("hourly accrual") ? "Annual Leave" : name;

  const fmtPct = (n: number, total: number) => {
    if (!total || n === 0) return <span className="text-muted-foreground">—</span>;
    return <span className="text-xs">{((n / total) * 100).toFixed(1)}%</span>;
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
          icon={<AlertTriangle className="w-5 h-5 text-rose-600" />}
          label="Total Absent"
          value={String(totals.absent)}
          sub={`Across ${activeAbsenceAccounts.length} absence type${activeAbsenceAccounts.length === 1 ? "" : "s"}`}
        />
      </div>

      {data.unmatchedAppUsers.length > 0 && (
        <div className="bg-secondary/50 border border-border rounded-xl p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="font-medium">{data.unmatchedAppUsers.length}</span>{" "}
              app user{data.unmatchedAppUsers.length === 1 ? "" : "s"} could not be matched to a Plan Day employee by email or name.
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

      {data.unmatchedPlandayEmployees && data.unmatchedPlandayEmployees.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm">
          <div className="font-medium text-blue-900 dark:text-blue-200 mb-2">
            {data.unmatchedPlandayEmployees.length} Plan Day employee{data.unmatchedPlandayEmployees.length === 1 ? "" : "s"} without a planner login
          </div>
          <div className="space-y-2">
            {data.unmatchedPlandayEmployees.map(emp => (
              <UnmatchedPlandayRow key={emp.plandayEmployeeId} employee={emp} />
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/50 border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground sticky left-0 bg-secondary/50">Employee</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">Total shifts</th>
                <th className="text-right px-3 py-3 font-medium text-rose-700">Total absent</th>
                <th className="text-right px-2 py-3 font-medium text-rose-700/70 text-xs">%</th>
                {activeShiftTypes.map(name => (
                  <Fragment key={`sh:${name}`}>
                    <th
                      className={cn(
                        "text-right px-3 py-3 font-medium whitespace-nowrap",
                        unpaidMap[name] ? "text-rose-700" : "text-muted-foreground",
                      )}
                    >
                      {name}
                    </th>
                    <th
                      className={cn(
                        "text-right px-2 py-3 font-medium text-xs whitespace-nowrap",
                        unpaidMap[name] ? "text-rose-700/70" : "text-muted-foreground/70",
                      )}
                    >
                      %
                    </th>
                  </Fragment>
                ))}
                {activeAbsenceAccounts.map(name => (
                  <Fragment key={`ab:${name}`}>
                    <th className="text-right px-3 py-3 font-medium text-rose-700 whitespace-nowrap">
                      {displayAbsenceAccountName(name)}
                    </th>
                    <th className="text-right px-2 py-3 font-medium text-rose-700/70 text-xs">%</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsToShow.length === 0 && (
                <tr>
                  <td colSpan={4 + activeShiftTypes.length * 2 + activeAbsenceAccounts.length * 2} className="text-center text-muted-foreground py-8">
                    No employees to show.
                  </td>
                </tr>
              )}
              {rowsToShow.map(r => (
                <tr
                  key={r.userId}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    !r.linked && "opacity-60",
                  )}
                >
                  <td className="px-4 py-3 sticky left-0 bg-card">
                    <div className="font-medium">{r.userName}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.userEmail}
                      {!r.linked && <span className="ml-2 text-amber-600">• not linked</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.totalShifts}</td>
                  <td className={cn("px-3 py-3 text-right tabular-nums", r.totalAbsent > 0 ? "text-rose-700 font-medium" : "text-muted-foreground")}>
                    {r.totalAbsent}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    {fmtPct(r.totalAbsent, r.totalShifts)}
                  </td>
                  {activeShiftTypes.map(name => {
                    const n = r.shiftTypeCounts?.[name] ?? 0;
                    const isUnpaid = unpaidMap[name];
                    return (
                      <Fragment key={`sh:${name}`}>
                        <td
                          className={cn(
                            "px-3 py-3 text-right tabular-nums",
                            n > 0 && isUnpaid && "text-rose-700 font-medium",
                            n > 0 && !isUnpaid && "text-amber-700 font-medium",
                            n === 0 && "text-muted-foreground",
                          )}
                        >
                          {n}
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums">
                          {fmtPct(n, r.totalShifts)}
                        </td>
                      </Fragment>
                    );
                  })}
                  {activeAbsenceAccounts.map(name => {
                    const n = r.absenceAccountCounts?.[name] ?? 0;
                    return (
                      <Fragment key={`ab:${name}`}>
                        <td className={cn("px-3 py-3 text-right tabular-nums", n > 0 ? "text-rose-700 font-medium" : "text-muted-foreground")}>
                          {n}
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums">
                          {fmtPct(n, r.totalShifts)}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
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
            Each column above corresponds to a Plan Day shift type or absence account that had at least one entry in the selected range. Shift types whose name contains “late” also roll up into the Arrived Late summary card. “Total Absent” sums every approved absence day across all accounts.
          </p>
        </details>
      )}
    </>
  );
}
