import { useState, useEffect, useRef, useMemo } from "react";
import { useListProductionPlans, useListDispatchOrders, useGetProductionPlan } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { EightPackOrdersBanner } from "@/components/eight-pack-orders-banner";
import { StockGateBanner } from "@/components/stock-gate-banner";
import { useRefreshSpin } from "@/hooks/use-refresh-spin";
import { format, isToday, startOfWeek, addWeeks, addDays } from "date-fns";
import { ArrowRight, ChefHat, Truck, Package, RefreshCw, ChevronLeft, ChevronRight, PackageCheck, LineChart, Thermometer, AlertTriangle, CheckCircle, X, Sparkles, Salad, UserPlus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { compareItemsForDisplay } from "@/pages/station/shared/constants";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { FreshnessBadge } from "@/components/govee-freshness";

interface AndonIssueSummary {
  id: number;
  category: string;
  severity: "green" | "yellow" | "red";
  description: string | null;
  station: string;
  reportedByName: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

const STATION_LABELS: Record<string, string> = {
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
  general: "General",
};

// Default: only admins see the dashboard issue banner. Managers/etc can be
// enabled later from Settings → Features → "Dashboard Issue Banner".
const DEFAULT_BANNER_ROLES: Record<string, boolean> = {
  admin: true,
  manager: false,
  employee: false,
  viewer: false,
};

function useBannerRoles() {
  const [roles, setRoles] = useState<Record<string, boolean>>(DEFAULT_BANNER_ROLES);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch(`${BASE}/api/app-settings/dashboard_issue_banner_roles`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.value) {
          try { setRoles({ ...DEFAULT_BANNER_ROLES, ...JSON.parse(d.value) }); } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  return { roles, loaded };
}

function AndonBanner({ userRole }: { userRole?: string }) {
  const [issues, setIssues] = useState<AndonIssueSummary[]>([]);
  const [acknowledging, setAcknowledging] = useState<number | null>(null);

  const hasToastedRef = useRef(false);
  async function fetchIssues() {
    try {
      const res = await fetch(`${BASE}/api/andon?open=true`, { credentials: "include" });
      if (!res.ok) return;
      const all: AndonIssueSummary[] = await res.json();
      hasToastedRef.current = false;
      const unacked = all.filter((i) => !i.acknowledgedAt);
      const rank = (s: AndonIssueSummary["severity"]) => s === "red" ? 0 : s === "yellow" ? 1 : 2;
      unacked.sort((a, b) => {
        const r = rank(a.severity) - rank(b.severity);
        if (r !== 0) return r;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      setIssues(unacked);
    } catch (err) {
      console.warn("[AndonBanner] Failed to fetch issues:", err);
      if (!hasToastedRef.current) {
        hasToastedRef.current = true;
        toast({ title: "Failed to load issues", description: "Could not fetch active issues.", variant: "destructive" });
      }
    }
  }

  useEffect(() => {
    fetchIssues();
    const interval = setInterval(fetchIssues, 30000);
    return () => clearInterval(interval);
  }, []);

  async function acknowledge(id: number) {
    setAcknowledging(id);
    try {
      await fetch(`${BASE}/api/andon/${id}/acknowledge`, { method: "PATCH", credentials: "include" });
      await fetchIssues();
    } catch (err) {
      console.warn("[AndonBanner] Failed to acknowledge issue:", err);
      toast({ title: "Acknowledge failed", description: "Could not acknowledge the issue. Please try again.", variant: "destructive" });
    }
    setAcknowledging(null);
  }

  if (issues.length === 0) return null;

  const isManager = userRole === "admin" || userRole === "manager";

  return (
    <div className="sticky top-0 z-20 -mx-6 px-6 pb-2 pt-0 bg-background/80 backdrop-blur-sm">
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-destructive/10 border-b border-destructive/20">
          <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
          <span className="text-sm font-semibold text-destructive">
            {issues.length} unacknowledged issue{issues.length !== 1 ? "s" : ""}
          </span>
          <Link
            href="/reports?tab=issues"
            className="ml-auto flex items-center gap-1 text-xs font-medium text-destructive/70 hover:text-destructive transition-colors flex-shrink-0"
          >
            View full log <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="divide-y divide-border/50">
          {issues.map(issue => (
            <div key={issue.id} className={cn(
              "flex items-center gap-3 px-4 py-2.5",
              issue.severity === "red"
                ? "bg-red-50/50 dark:bg-red-950/20"
                : issue.severity === "green"
                  ? "bg-emerald-50/50 dark:bg-emerald-950/20"
                  : "bg-yellow-50/50 dark:bg-yellow-950/20"
            )}>
              <span className={cn(
                "w-2.5 h-2.5 rounded-full flex-shrink-0",
                issue.severity === "red" ? "bg-red-500" : issue.severity === "green" ? "bg-emerald-500" : "bg-yellow-400"
              )} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium capitalize">{issue.category}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {STATION_LABELS[issue.station] ?? issue.station}
                  {issue.reportedByName ? ` · ${issue.reportedByName}` : ""}
                </span>
                {issue.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{issue.description}</p>
                )}
              </div>
              <span className={cn(
                "text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0",
                issue.severity === "red"
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                  : issue.severity === "green"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
              )}>
                {issue.severity === "red" ? "Serious" : issue.severity === "green" ? "Wish List" : "Minor"}
              </span>
              {isManager && (
                <button
                  onClick={() => acknowledge(issue.id)}
                  disabled={acknowledging === issue.id}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border rounded-lg hover:bg-secondary transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  {acknowledging === issue.id ? "..." : "Acknowledge"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TodayPlanRecipes({ planId }: { planId: number }) {
  const { data: plan, isLoading } = useGetProductionPlan(planId) as { data: any; isLoading: boolean };
  if (isLoading) return <p className="text-xs text-muted-foreground px-1">Loading…</p>;
  const items = (plan?.items ?? [])
    .filter((it: any) => (it.batchesTarget ?? 0) > 0)
    .sort(compareItemsForDisplay);
  if (items.length === 0) return <p className="text-xs text-muted-foreground px-1">No recipes with batches.</p>;
  return (
    <div className="space-y-1.5">
      {items.map((it: any) => {
        // Mac cheese is tracked in packs (1 batch = 1 pack); calzones in
        // batches. Match the unit the rest of the app uses for each.
        const isMac = it.recipeCategory === MAC_CHEESE_CATEGORY;
        const unit = isMac
          ? `pack${it.batchesTarget !== 1 ? "s" : ""}`
          : `batch${it.batchesTarget !== 1 ? "es" : ""}`;
        return (
          <div key={it.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-secondary/50 transition-colors">
            <span className="text-sm font-medium truncate pr-2" style={it.recipeColor ? { color: it.recipeColor } : undefined}>
              {it.recipeName ?? "Unknown"}
            </span>
            <span className="text-sm font-bold tabular-nums shrink-0" style={it.recipeColor ? { color: it.recipeColor } : undefined}>
              {it.batchesTarget} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

const MAC_CHEESE_CATEGORY = "Macaroni Cheese";

/** Returns separate totals so calzone batches (10-portion batches) aren't
 *  conflated with mac cheese packs (1 mac batch = 1 pack). Also sums how far
 *  the day has actually got — batches built past the building tables and
 *  packs landed in the fridge/freezer off wrapping — purely so the dashboard
 *  cards can show at-a-glance progress. Packs (not flavours) measure wrapping:
 *  a flavour can be two packs or forty, so pack counts are the honest bar. */
async function fetchTodayBatchCount(planIds: number[]): Promise<{
  calzoneBatches: number;
  macPacks: number;
  calzoneBuilt: number;
  packsTotal: number;
  packsWrapped: number;
}> {
  const empty = { calzoneBatches: 0, macPacks: 0, calzoneBuilt: 0, packsTotal: 0, packsWrapped: 0 };
  if (planIds.length === 0) return empty;
  const totals = { ...empty };
  for (const id of planIds) {
    const res = await fetch(`${BASE}/api/production-plans/${id}`, { credentials: "include" });
    if (!res.ok) continue;
    const plan = await res.json();
    for (const it of plan.items ?? []) {
      const target = it.batchesTarget ?? 0;
      const sc = it.stationCompletions ?? {};
      const built = (sc.building_1 ?? 0) + (sc.building_2 ?? 0);
      if (it.recipeCategory === MAC_CHEESE_CATEGORY) {
        totals.macPacks += target;
      } else {
        totals.calzoneBatches += target;
        // Cap per item so extra packs can't push the day past its total
        totals.calzoneBuilt += Math.min(built, target);
      }
      if (target > 0) {
        // Planned pack units for the day: 2-packs after the 8-pack bags take
        // their 4 two-packs' worth of portions, plus the bags themselves.
        // (Mac cheese falls out naturally: 2 portions/batch ÷ pack of 2.)
        const bags = it.eightPackBagCount ?? 0;
        const plannedTwoPacks = Math.max(0, Math.floor((target * (it.portionsPerBatch ?? 10)) / 2) - bags * 4);
        const itemTotal = plannedTwoPacks + bags;
        // Wrapped = pack units that have physically landed in storage.
        const wrapped = (it.fridgeQty ?? 0) + (it.fridgeEightPackQty ?? 0) + (it.freezerEightPackQty ?? 0);
        totals.packsTotal += itemTotal;
        totals.packsWrapped += Math.min(wrapped, itemTotal);
      }
    }
  }
  return totals;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getDefaultWeekOffset(): number {
  const now = new Date();
  const day = now.getDay();
  if (day === 6) return 1;
  if (day === 0) return 1;
  if (day === 5 && now.getHours() >= 15) return 1;
  return 0;
}

function getMonday(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

async function fetchWeeklyOrders(weekStart: string) {
  const res = await fetch(`${BASE}/api/shopify/weekly-orders?weekStart=${encodeURIComponent(weekStart)}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch weekly orders");
  const data = await res.json();
  return (data.days ?? data) as { date: string; deliveryDate: string; day: string; orderCount: number; fulfilledCount: number; unfulfilledCount: number; packCount: number }[];
}

/** Deliveries expected today, split into arrived (received / partially
 *  received — same rule the Deliveries page uses) vs still to come. */
async function fetchTodayDeliveriesCount(): Promise<{ total: number; arrived: number }> {
  const today = new Date().toISOString().split("T")[0];
  const res = await fetch(`${BASE}/api/deliveries/weekly?weekOf=${today}`, { credentials: "include" });
  if (!res.ok) return { total: 0, arrived: 0 };
  const data = await res.json();
  const orders = data.orders ?? data ?? [];
  const todays = orders.filter((o: any) => o.expectedDeliveryDate === today);
  const arrived = todays.filter((o: any) => o.status === "received" || o.status === "partially_received").length;
  return { total: todays.length, arrived };
}

const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

type UpcomingPlan = {
  id: number;
  planDate: string;
  name: string;
  status: "draft" | "active" | "prep" | "building" | "complete";
  items?: Array<{ recipeCategory?: string | null; batchesTarget?: number | null }>;
};

const PLAN_STATUS_STYLE: Record<string, string> = {
  draft:    "bg-muted text-muted-foreground",
  active:   "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  prep:     "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  building: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  complete: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

/** Forward look at scheduled production: a bar chart of calzone batches per
 *  upcoming day plus a table of the plans — so the team can always see
 *  what's coming. Calzone batches are split from mac cheese (1 mac batch =
 *  1 pack), matching the unit convention everywhere else. */
function UpcomingProductionPanel() {
  const [, setLocation] = useLocation();
  const { data: plans, isLoading, error } = useQuery<UpcomingPlan[]>({
    queryKey: ["dashboard-upcoming-plans"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/production-plans`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load production plans");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const rows = (plans ?? [])
    .filter(p => p.planDate >= todayStr)
    .sort((a, b) => a.planDate.localeCompare(b.planDate))
    .slice(0, 8)
    .map(p => {
      const items = p.items ?? [];
      const calzoneBatches = items
        .filter(it => (it.recipeCategory ?? "") !== MAC_CHEESE_CATEGORY)
        .reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
      const macPacks = items
        .filter(it => (it.recipeCategory ?? "") === MAC_CHEESE_CATEGORY)
        .reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
      const d = new Date(`${p.planDate}T00:00:00`);
      return {
        ...p,
        calzoneBatches,
        macPacks,
        isToday: p.planDate === todayStr,
        longLabel: format(d, "EEE d MMM"),
        shortLabel: format(d, "EEE d"),
      };
    });

  return (
    <div className="glass-panel p-6 rounded-2xl mt-6">
      <div className="flex items-center justify-between mb-1">
        <Link href="/plans" className="group inline-flex items-center gap-1.5 hover:text-primary transition-colors">
          <h3 className="font-display font-bold text-lg group-hover:text-primary transition-colors">Upcoming Production</h3>
          <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Calzone batches scheduled on each production day. Mac cheese shown separately (packs).</p>

      {isLoading ? (
        <div className="flex items-center justify-center h-[200px] text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin mr-2" /><span className="text-sm">Loading plans…</span>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-[200px] text-destructive text-sm">Could not load production plans.</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
          <Package className="w-10 h-10 mb-2 opacity-20" /><p className="text-sm">No upcoming production plans.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Bar chart — calzone batches per day */}
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="shortLabel" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} interval={0} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--secondary))" }}
                  formatter={(v: number) => [`${v} batches`, "Calzones"]}
                  labelFormatter={(l: string) => rows.find(r => r.shortLabel === l)?.longLabel ?? l}
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                />
                <Bar
                  dataKey="calzoneBatches"
                  radius={[6, 6, 0, 0]}
                  cursor="pointer"
                  onClick={(data: { id?: number }) => { if (data?.id != null) setLocation(`/plans?planId=${data.id}`); }}
                >
                  {rows.map(r => (
                    <Cell key={r.id} fill={r.isToday ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.35)"} style={{ cursor: "pointer" }} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table — the plans themselves */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="text-left font-semibold py-2 pr-2">Day</th>
                  <th className="text-left font-semibold py-2 pr-2">Plan</th>
                  <th className="text-center font-semibold py-2 px-2">Status</th>
                  <th className="text-right font-semibold py-2 pl-2">Calzones</th>
                  <th className="text-right font-semibold py-2 pl-3">Mac</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className={cn("border-b border-border/50", r.isToday && "bg-primary/5")}>
                    <td className="py-2 pr-2 whitespace-nowrap font-medium">
                      <Link href={`/plans?planId=${r.id}`} className="hover:text-primary transition-colors">
                        {r.longLabel}{r.isToday && <span className="ml-1.5 text-[10px] uppercase text-primary font-bold">today</span>}
                      </Link>
                    </td>
                    <td className="py-2 pr-2 text-muted-foreground truncate max-w-[10rem]">{r.name}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={cn("text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full", PLAN_STATUS_STYLE[r.status] ?? "bg-muted text-muted-foreground")}>{r.status}</span>
                    </td>
                    <td className="py-2 pl-2 text-right font-bold tabular-nums">{r.calzoneBatches}</td>
                    <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">{r.macPacks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const dashRefresh = useRefreshSpin();
  const { state } = useAuth();
  const isFounder = state.status === "authenticated" && state.user.email === FOUNDER_EMAIL;
  const [, setLocation] = useLocation();

  // The founder's day starts on Founder Focus, not the kitchen dashboard:
  // the first "/" load of each app session redirects there (his user only).
  // sessionStorage scopes the flag to the window session, so relaunching
  // the installed app redirects again, while deliberately navigating back
  // to the Dashboard mid-session stays put.
  useEffect(() => {
    if (isFounder && !sessionStorage.getItem("founderFocusAutoOpened")) {
      sessionStorage.setItem("founderFocusAutoOpened", "1");
      setLocation("/founder/focus");
    }
  }, [isFounder, setLocation]);
  const { data: plans } = useListProductionPlans();
  const { data: dispatches } = useListDispatchOrders();
  const { roles: bannerRoles, loaded: bannerRolesLoaded } = useBannerRoles();
  const userRole = state.status === "authenticated" ? state.user.role : undefined;
  const showIssueBanner = bannerRolesLoaded && !!userRole && bannerRoles[userRole] === true;

  const [weekOffset, setWeekOffset] = useState<number>(getDefaultWeekOffset);
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");
  const currentMonday = getMonday(today);
  const selectedMonday = addWeeks(currentMonday, weekOffset);
  const weekStartStr = format(selectedMonday, "yyyy-MM-dd");
  const weekSunday = new Date(selectedMonday);
  weekSunday.setDate(weekSunday.getDate() + 6);
  const weekLabel = `${format(selectedMonday, "d MMM")} – ${format(weekSunday, "d MMM yyyy")}`;
  const isCurrentWeek = weekOffset === 0;

  // Calzone packs planned per day this week — drawn beside the dispatch
  // packs so making-vs-dispatching compares in the same unit.
  const { data: weekPacksMade } = useQuery({
    queryKey: ["packs-by-date", weekStartStr],
    queryFn: async () => {
      const end = format(addDays(selectedMonday, 6), "yyyy-MM-dd");
      const res = await fetch(`${BASE}/api/production-plans/packs-by-date?start=${weekStartStr}&end=${end}`, { credentials: "include" });
      if (!res.ok) return [] as { date: string; calzonePacks: number }[];
      return res.json() as Promise<{ date: string; calzonePacks: number }[]>;
    },
    refetchInterval: 60000,
  });
  const madePacksByDate = new Map((weekPacksMade ?? []).map(r => [r.date, r.calzonePacks]));

  // Forecast capacity for weekdays that have NO production plan yet, today
  // onwards. Deliberately calls the SAME /schedule-capacity endpoint the
  // Create Plan dialog uses (Planday shifts → dough-prep rule → capacity
  // settings), so this forecast can never drift from the planner's own
  // suggestion. Packs = batches × 5 (default 10 portions per batch ÷ 2 per
  // pack — how plan batches translate to calzone packs).
  const plannedDatesKey = (weekPacksMade ?? []).map(r => `${r.date}:${r.calzonePacks}`).join(",");
  const { data: forecastByDate } = useQuery({
    queryKey: ["capacity-forecast", weekStartStr, plannedDatesKey],
    enabled: !!weekPacksMade,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const dates: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(selectedMonday, i);
        const ds = format(d, "yyyy-MM-dd");
        const isWeekday = d.getDay() >= 1 && d.getDay() <= 5;
        const hasPlan = (madePacksByDate.get(ds) ?? 0) > 0;
        if (isWeekday && !hasPlan && ds >= today) dates.push(ds);
      }
      const out: Record<string, number> = {};
      await Promise.all(dates.map(async ds => {
        try {
          const res = await fetch(`${BASE}/api/production-plans/schedule-capacity?planDate=${ds}`, { credentials: "include" });
          if (!res.ok) return;
          const data = await res.json() as { available?: boolean; capacityBatches?: number };
          if (data?.available && Number.isFinite(data.capacityBatches)) {
            out[ds] = Math.round((data.capacityBatches as number) * 5);
          }
        } catch { /* Planday hiccup — that day simply shows no forecast bar */ }
      }));
      return out;
    },
  });

  const { data: weeklyOrders, isLoading: weeklyLoading, error: weeklyError, refetch } = useQuery({
    queryKey: ["shopify-weekly-orders-dashboard", weekStartStr],
    queryFn: () => fetchWeeklyOrders(weekStartStr),
    staleTime: 5 * 60 * 1000,
  });

  // Seven days plus a WEEK TOTAL column on the end, so the week's making vs
  // dispatching can be read at a glance instead of added up in your head
  // (Graeme, 2026-08-12). The total is a synthetic row: it carries isTotal so
  // the tooltip, the axis label and the bar colour can treat it as a summary
  // rather than an eighth day.
  // Days only — the week total lives in its own block BESIDE the chart, on
  // its own scale. When it was an eighth bar it dictated the Y axis and
  // squashed every daily bar to a sliver (Graeme, 2026-08-19).
  const dispatchChartData = useMemo(() => {
    if (!weeklyOrders) return undefined;
    return weeklyOrders.map(d => ({
      ...d,
      madePacks: madePacksByDate.get(d.date) ?? 0,
      forecastPacks: forecastByDate?.[d.date] ?? 0,
    }));
  }, [weeklyOrders, weekPacksMade, forecastByDate]);

  const dispatchWeekTotals = useMemo(() => {
    if (!dispatchChartData) return undefined;
    const sum = (pick: (d: NonNullable<typeof dispatchChartData>[number]) => number) =>
      dispatchChartData.reduce((s, d) => s + pick(d), 0);
    return {
      orderCount: sum(d => d.orderCount),
      fulfilledCount: sum(d => d.fulfilledCount),
      packCount: sum(d => d.packCount),
      madePacks: sum(d => d.madePacks),
      forecastPacks: sum(d => d.forecastPacks),
    };
  }, [dispatchChartData]);

  const { data: todayDeliveriesCount } = useQuery({
    queryKey: ["today-deliveries-count"],
    queryFn: fetchTodayDeliveriesCount,
    staleTime: 5 * 60 * 1000,
  });

  const { data: stockControlData } = useQuery({
    queryKey: ["stock-control-dashboard"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/stock-control`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ productionFridgeTotal: number }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const todayPlans = plans?.filter(p => isToday(new Date(p.planDate))) || [];
  const todayPlanIds = todayPlans.map(p => p.id);

  const { data: totalBatches, isLoading: batchesLoading } = useQuery({
    queryKey: ["today-batch-count", todayPlanIds.join(",")],
    queryFn: () => fetchTodayBatchCount(todayPlanIds),
    enabled: todayPlanIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const todayDispatches = dispatches?.filter(d => d.dispatchDate === todayStr) || [];

  // Live team batches/hr for today's build — the same standard number the
  // building station shows (calzone-only, lib/batches-per-hour), so the
  // kitchen dashboard always has the day's pace in view.
  const { data: buildKpi } = useQuery({
    queryKey: ["dashboard-build-kpi", todayPlanIds[0]],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/production-plans/${todayPlanIds[0]}/kpi?stationType=building_1`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ batchesPerHour?: number }>;
    },
    enabled: todayPlanIds.length > 0,
    refetchInterval: 30000,
  });
  const teamBph = buildKpi?.batchesPerHour ?? 0;

  // Packing pace for today's dispatch — orders/hr from Shopify fulfilment
  // timestamps, the same number as the packing station's "Packed today" tile.
  const { data: packingSpeed } = useQuery({
    queryKey: ["dashboard-packing-speed", todayStr],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/reports/packing-speed?from=${todayStr}&to=${todayStr}`, { credentials: "include" });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.dailyRows?.[0] ?? null) as { ordersPerHour: number | null; count: number } | null;
    },
    refetchInterval: 60000,
  });
  const packingOph = packingSpeed?.ordersPerHour ?? 0;

  // The "Packing" card is pinned to the REAL current week, not the
  // weekly panel's selection — getDefaultWeekOffset rolls the panel to next
  // week from Friday 3pm, which used to blank this card for the rest of the
  // day. Today's card must reflect today until midnight. Same query key
  // family, so on offset 0 it dedupes with the panel's fetch.
  const currentWeekStartStr = format(currentMonday, "yyyy-MM-dd");
  const { data: currentWeekOrders, isLoading: currentWeekLoading } = useQuery({
    queryKey: ["shopify-weekly-orders-dashboard", currentWeekStartStr],
    queryFn: () => fetchWeeklyOrders(currentWeekStartStr),
    staleTime: 5 * 60 * 1000,
  });

  const todayTag = format(today, "yyyy-MM-dd");
  const todayIndex = currentWeekOrders?.findIndex(d => d.date === todayTag) ?? -1;
  const todayShopifyOrderCount = todayIndex >= 0 ? currentWeekOrders![todayIndex].orderCount : null;

  // Prep card — prep stations work ahead of production, so this follows the
  // same next-plan-by-prep_date resolver the prep stations themselves use.
  // Headline = batches on the plan being prepped; bar = tins prepped.
  const { data: prepTarget } = useQuery({
    queryKey: ["dashboard-next-prep", todayStr],
    refetchInterval: 60000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/production-plans/next-active?afterDate=${todayStr}&for=prep`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ planId: number | null; planDate: string | null; status: string | null }>;
    },
  });
  const prepPlanId = prepTarget?.planId ?? null;
  const { data: prepBatches } = useQuery({
    queryKey: ["dashboard-prep-batches", prepPlanId],
    enabled: prepPlanId != null,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchTodayBatchCount([prepPlanId!]),
  });
  const { data: prepProgress } = useQuery({
    queryKey: ["dashboard-prep-progress", prepPlanId],
    enabled: prepPlanId != null,
    refetchInterval: 30000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/production-plans/${prepPlanId}/prep-progress`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ totalTins: number; completedTins: number; pct: number }>;
    },
  });

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      // The week-total column is a summary, not a dispatch day — it has no
      // delivery date and its fulfilled/unfulfilled split isn't meaningful.
      if (item.isTotal) {
        const diff = (item.madePacks ?? 0) - (item.packCount ?? 0);
        return (
          <div className="bg-card border border-border rounded-xl px-4 py-3 shadow-lg text-sm space-y-1">
            <p className="font-semibold">Week total</p>
            <p className="font-bold pt-1">{item.packCount} packs dispatching</p>
            <p className="font-bold text-blue-500">{item.madePacks} calzone packs making</p>
            <p className={`text-xs pt-1 font-medium ${diff < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
              {diff === 0 ? "Level" : diff > 0 ? `${diff} packs ahead` : `${Math.abs(diff)} packs behind`}
            </p>
            <p className="text-xs text-muted-foreground">{item.orderCount} orders this week</p>
          </div>
        );
      }
      return (
        <div className="bg-card border border-border rounded-xl px-4 py-3 shadow-lg text-sm space-y-1">
          <p className="font-semibold">Dispatch: {item.date}</p>
          <p className="text-muted-foreground text-xs">Delivery: {item.deliveryDate}</p>
          <p className="font-bold pt-1">{item.packCount} packs dispatching</p>
          {(item.forecastPacks ?? 0) > 0 && (
            <p className="font-bold" style={{ color: "hsl(38 92% 50%)" }}>
              {item.forecastPacks} packs possible — no plan yet (team-based forecast)
            </p>
          )}
          {(item.madePacks ?? 0) > 0 && (
            <p className="font-bold text-blue-500">{item.madePacks} calzone packs making</p>
          )}
          <p className="text-xs text-muted-foreground pt-1">{item.orderCount} orders</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            <span>{item.fulfilledCount} fulfilled</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(var(--primary) / 0.3)" }} />
            <span>{item.unfulfilledCount} unfulfilled</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kitchen Dashboard"
        description={format(new Date(), "EEEE, MMMM do, yyyy")}
        action={
          <div className="flex items-center gap-2">
            <VisitorCheckInButton />
            {isFounder && (
              <Link href="/founder/focus">
                <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-secondary transition-colors">
                  <LineChart className="w-3.5 h-3.5" />
                  Founder Focus
                </button>
              </Link>
            )}
          </div>
        }
      />

      {showIssueBanner && <AndonBanner userRole={userRole} />}

      <EightPackOrdersBanner userRole={userRole} />
      <StockGateBanner userRole={userRole} />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          title="Building"
          value={batchesLoading ? "…" : formatProgressValue(totalBatches?.calzoneBuilt ?? 0, totalBatches?.calzoneBatches ?? 0)}
          subtitle={batchesLoading ? undefined : [
            teamBph > 0 ? `${teamBph.toFixed(1)} batches/hr` : null,
            (totalBatches?.macPacks ?? 0) > 0 ? `+ ${totalBatches!.macPacks} mac packs` : null,
          ].filter(Boolean).join(" · ") || undefined}
          icon={ChefHat}
          color="text-primary"
          bg="bg-primary/10"
          href={todayPlans.length > 0 ? `/plans?planId=${todayPlans[0].id}` : "/plans"}
          progress={!batchesLoading && (totalBatches?.calzoneBatches ?? 0) > 0 ? {
            done: totalBatches!.calzoneBuilt,
            total: totalBatches!.calzoneBatches,
            label: "built",
            barClass: "bg-primary",
            hideDetail: true,
          } : undefined}
        />
        <StatCard
          title="Prepping For"
          value={prepPlanId == null ? "—" : (prepBatches?.calzoneBatches ?? "…").toString()}
          subtitle={prepTarget?.planDate
            ? `batches · ${format(new Date(prepTarget.planDate + "T00:00:00"), "EEE d MMM")}`
            : "no upcoming plan"}
          icon={Salad}
          color="text-green-500"
          bg="bg-green-500/10"
          // direct=1 anchors the prep station to THIS plan — the card has
          // already resolved "whose prep is due today" by date. Without it
          // the station re-runs the next-active auto-route from the landed
          // plan's own plan_date and hops one prep day further ahead
          // (tomorrow's prep), which is only wanted when arriving from a
          // production plan's page, not from this date-based card.
          href={prepPlanId ? `/plans/${prepPlanId}/station/prep?direct=1` : "/plans"}
          progress={prepProgress && prepProgress.totalTins > 0 ? {
            done: prepProgress.completedTins,
            total: prepProgress.totalTins,
            label: "tins prepped",
            barClass: "bg-green-500",
          } : undefined}
        />
        <StatCard
          title="Packing"
          value={currentWeekLoading ? "…" : (todayShopifyOrderCount ?? todayDispatches.length).toString()}
          subtitle={packingOph > 0 ? `${packingOph.toFixed(1)} orders/hr packed` : undefined}
          icon={Truck}
          color="text-blue-500"
          bg="bg-blue-500/10"
          // Straight into today's PACKING STATION — that's where the person
          // tapping this card is headed (Graeme, 2026-08-19; it used to jump
          // to the despatch page instead). Falls back to the despatch wave
          // when no plan is open today.
          href={todayPlans.length > 0
            ? `/plans/${todayPlans[0].id}/station/packing`
            : `/fulfilment?tag=${format(addDays(new Date(), 1), "yyyy-MM-dd")}`}
          progress={todayIndex >= 0 && (currentWeekOrders![todayIndex].orderCount ?? 0) > 0 ? {
            done: currentWeekOrders![todayIndex].fulfilledCount,
            total: currentWeekOrders![todayIndex].orderCount,
            label: "fulfilled",
            barClass: "bg-blue-500",
          } : undefined}
        />
        <StatCard
          title="Deliveries Arriving"
          value={formatProgressValue(todayDeliveriesCount?.arrived ?? 0, todayDeliveriesCount?.total ?? 0)}
          icon={PackageCheck}
          color="text-emerald-500"
          bg="bg-emerald-500/10"
          href="/deliveries"
          progress={(todayDeliveriesCount?.total ?? 0) > 0 ? {
            done: todayDeliveriesCount!.arrived,
            total: todayDeliveriesCount!.total,
            label: "arrived",
            barClass: "bg-emerald-500",
            hideDetail: true,
          } : undefined}
        />
        <StatCard
          title="Wrapping"
          value={batchesLoading ? "…" : formatProgressValue(totalBatches?.packsWrapped ?? 0, totalBatches?.packsTotal ?? 0)}
          subtitle={stockControlData == null
            ? "Tap for pack report"
            : `Factory #${(stockControlData.productionFridgeTotal ?? 0).toLocaleString()} · tap for pack report`}
          icon={Thermometer}
          color="text-cyan-500"
          bg="bg-cyan-500/10"
          href="/pack-report"
          progress={!batchesLoading && (totalBatches?.packsTotal ?? 0) > 0 ? {
            done: totalBatches!.packsWrapped,
            total: totalBatches!.packsTotal,
            label: "packs wrapped",
            barClass: "bg-cyan-500",
            hideDetail: true,
          } : undefined}
        />
        <StatCard
          title="Morning Meeting"
          value="▶"
          subtitle="10-min Two Second Lean"
          icon={Sparkles}
          color="text-amber-500"
          bg="bg-amber-500/10"
          href="/meeting"
        />
      </div>

      <GoveeTempTile />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        <Link href="/plans" className="glass-panel rounded-2xl flex flex-col group cursor-pointer hover-lift">
          <div className="p-6 border-b border-border flex items-center justify-between">
            <h3 className="font-display font-bold text-lg">Today's Production</h3>
            <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="p-4 flex-1 overflow-y-auto">
            {todayPlans.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Package className="w-10 h-10 mb-2 opacity-20" />
                <p className="text-sm">No plans for today.</p>
              </div>
            ) : (
              <div className="space-y-5">
                {todayPlans.map(plan => (
                  <div key={plan.id}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 mb-1">{plan.name}</p>
                    <TodayPlanRecipes planId={plan.id} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Link>

        <div className="lg:col-span-2 glass-panel p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Link href="/dispatches" className="group inline-flex items-center gap-1.5 hover:text-primary transition-colors">
                  <h3 className="font-display font-bold text-lg group-hover:text-primary transition-colors">Dispatch Orders</h3>
                  <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
                {isCurrentWeek && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">This Week</span>
                )}
                {weekOffset < 0 && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Past</span>
                )}
                {weekOffset > 0 && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">Upcoming</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setWeekOffset(o => o - 1)}
                  className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                  title="Previous week"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-medium min-w-[170px] text-center">{weekLabel}</span>
                <button
                  onClick={() => setWeekOffset(o => o + 1)}
                  className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                  title="Next week"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                {!isCurrentWeek && (
                  <button
                    onClick={() => setWeekOffset(0)}
                    className="text-xs text-primary hover:underline ml-1"
                  >
                    This week
                  </button>
                )}
              </div>
              {/* Legend as big solid blocks in each series' colour — the tiny
                  dot legend was unreadable at a glance (Graeme, 2026-08-20). */}
              <div className="flex items-center gap-2 mt-2">
                <span className="px-4 py-1.5 rounded-lg text-base font-bold text-white" style={{ background: "hsl(var(--primary))" }}>
                  Dispatching <span className="font-normal text-sm opacity-80">(packs)</span>
                </span>
                <span className="px-4 py-1.5 rounded-lg text-base font-bold text-white" style={{ background: "hsl(217 91% 60%)" }}>
                  Making <span className="font-normal text-sm opacity-80">(calzone packs)</span>
                </span>
                {(dispatchWeekTotals?.forecastPacks ?? 0) > 0 && (
                  <span className="px-4 py-1.5 rounded-lg text-base font-bold text-white" style={{ background: "hsl(38 92% 50%)" }}>
                    Could make <span className="font-normal text-sm opacity-80">(forecast)</span>
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => { dashRefresh.triggerSpin(); refetch(); }}
              disabled={weeklyLoading}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${weeklyLoading || dashRefresh.spinning ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          <div className="h-[300px] w-full flex items-stretch">
            {weeklyLoading ? (
              <div className="flex items-center justify-center h-full w-full text-muted-foreground">
                <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                <span className="text-sm">Fetching Shopify orders…</span>
              </div>
            ) : weeklyError ? (
              <div className="flex items-center justify-center h-full w-full text-destructive text-sm">
                Could not load order data. Check Shopify connection.
              </div>
            ) : (
              <>
              <div className="flex-1 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={dispatchChartData}
                  barSize={34}
                  barGap={3}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="day"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={32}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--secondary))" }} />
                  {/* Both bars are PACKS so the eye can honestly compare
                      dispatch volume against production volume. Orders and
                      fulfilment progress live in the tooltip and summary.
                      Each bar carries its own number + what it is: inside
                      and rotated when there's room, perched on top when
                      the bar is too short. */}
                  <Bar dataKey="packCount" name="Dispatching (packs)" radius={[6, 6, 0, 0]}>
                    {dispatchChartData?.map((entry, i) => (
                      <Cell
                        key={entry.date}
                        // Solid enough that the white in-bar number reads;
                        // today still pops at full strength.
                        fill={i === todayIndex ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.7)"}
                      />
                    ))}
                    <LabelList dataKey="packCount" content={renderBarLabel} />
                  </Bar>
                  <Bar dataKey="madePacks" name="Making (calzone packs)" radius={[6, 6, 0, 0]}>
                    {dispatchChartData?.map(entry => (
                      <Cell
                        key={entry.date}
                        fill="hsl(217 91% 60% / 0.85)"
                      />
                    ))}
                    <LabelList dataKey="madePacks" content={renderBarLabel} />
                  </Bar>
                  {/* Forecast: what we COULD make on plan-less weekdays at
                      the Create Plan dialog's own suggested capacity — only
                      non-zero on days with no plan, so it never doubles up
                      with a Making bar. */}
                  <Bar dataKey="forecastPacks" name="Could make (forecast)" radius={[6, 6, 0, 0]}>
                    {dispatchChartData?.map(entry => (
                      <Cell
                        key={entry.date}
                        fill="hsl(38 92% 50% / 0.85)"
                      />
                    ))}
                    <LabelList dataKey="forecastPacks" content={renderBarLabel} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
              {/* Week total on its OWN scale, clearly fenced off from the
                  daily bars — as a bar it dwarfed them into unreadability. */}
              {dispatchWeekTotals && (
                <div className="w-[150px] shrink-0 border-l-2 border-border pl-4 ml-3 flex flex-col justify-center gap-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Week total</p>
                  <div>
                    <p className="text-3xl font-display font-bold tabular-nums text-primary">
                      {dispatchWeekTotals.packCount.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground leading-snug">dispatching (packs)</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                      {dispatchWeekTotals.fulfilledCount} / {dispatchWeekTotals.orderCount} orders fulfilled
                    </p>
                  </div>
                  <div>
                    <p className="text-3xl font-display font-bold tabular-nums" style={{ color: "hsl(217 91% 60%)" }}>
                      {dispatchWeekTotals.madePacks.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground leading-snug">making (calzone packs)</p>
                  </div>
                  {dispatchWeekTotals.forecastPacks > 0 && (
                    <div>
                      <p className="text-3xl font-display font-bold tabular-nums" style={{ color: "hsl(38 92% 50%)" }}>
                        {dispatchWeekTotals.forecastPacks.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground leading-snug">could still make (forecast, unplanned days)</p>
                    </div>
                  )}
                </div>
              )}
              </>
            )}
          </div>

          {weeklyOrders && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground">
                  {weeklyOrders.reduce((s, d) => s + d.orderCount, 0)}
                </span>{" "}
                total orders {isCurrentWeek ? "this week" : ""}
              </span>
              <span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {weeklyOrders.reduce((s, d) => s + d.fulfilledCount, 0)}
                </span>{" "}fulfilled
              </span>
              {todayIndex >= 0 && (
                <span>
                  <span className="font-semibold text-primary">
                    {weeklyOrders[todayIndex].orderCount}
                  </span>{" "}
                  today
                </span>
              )}
              {/* Totals now live big in the Week Total block beside the
                  chart; this keeps just the up-or-down verdict. */}
              {(() => {
                if (!dispatchWeekTotals) return null;
                const diff = dispatchWeekTotals.madePacks - dispatchWeekTotals.packCount;
                return (
                  <span className="ml-auto">
                    week:{" "}
                    <span className={`font-semibold ${diff < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                      {diff === 0 ? "level" : diff > 0 ? `${diff} ahead` : `${Math.abs(diff)} behind`}
                    </span>
                  </span>
                );
              })()}
            </div>
          )}
        </div>

      </div>

      <UpcomingProductionPanel />
    </div>
  );
}

/** Opens the visitor-book kiosk (/visitor-check-in) — press it, hand the iPad
 *  over. Carries a live count of visitors still signed in so the dashboard
 *  doubles as the fire roll-call prompt. */
function VisitorCheckInButton() {
  const { data: onSite } = useQuery<Array<{ id: number }>>({
    queryKey: ["visitors-on-site"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/visitors/on-site`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 120_000,
    retry: false,
  });
  const count = onSite?.length ?? 0;

  return (
    <Link href="/visitor-check-in">
      <button className="flex items-center gap-1.5 text-xs font-medium text-primary border border-primary/30 bg-primary/10 rounded-lg px-3 py-2 hover:bg-primary/20 transition-colors">
        <UserPlus className="w-3.5 h-3.5" />
        Visitor Check-In
        {count > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold tabular-nums">
            {count} on site
          </span>
        )}
      </button>
    </Link>
  );
}

interface GoveeLiveSensor {
  device: string; name: string; locationName: string | null; zone: string | null;
  temperatureC: number | null; humidityPercent: number | null; online: boolean | null;
  thresholdC: number | null; breaching: boolean; readingAt: string | null;
  lastOnlineAt: string | null; stale: boolean;
}

// Live fridge/freezer temperatures from the Govee sensors. Renders nothing
// unless the feature + tile are enabled and at least one sensor is mapped.
function GoveeTempTile() {
  const { data } = useQuery<{ enabled: boolean; tileEnabled: boolean; sensors: GoveeLiveSensor[] }>({
    queryKey: ["govee-live"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/govee/live`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });

  if (!data?.enabled || !data?.tileEnabled) return null;
  const sensors = data.sensors ?? [];
  if (sensors.length === 0) return null;

  return (
    <div className="glass-panel rounded-2xl p-4 mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-bold text-lg flex items-center gap-2">
          <Thermometer className="w-5 h-5 text-cyan-500" /> Fridge &amp; Freezer
        </h3>
        <span className="text-xs uppercase tracking-widest text-muted-foreground">live</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {sensors.map((s) => (
          // Each tile deep-links straight to that sensor's history graph.
          <Link
            key={s.device}
            href={`/reports?tab=haccp&haccp=sensors&device=${encodeURIComponent(s.device)}`}
            className={`block rounded-xl p-3 border hover-lift cursor-pointer ${
              s.stale || s.breaching
                ? "border-red-500/50 bg-red-500/10"
                : "border-border bg-card"
            }`}
          >
            <p className="text-sm font-medium truncate">{s.name}</p>
            {/* When stale, the number is a frozen last-known value — dim it so it
                can't be read as a live temperature. */}
            <p className={`text-2xl font-display font-bold leading-tight ${
              s.stale ? "text-muted-foreground/50" : s.breaching ? "text-red-500" : "text-foreground"
            }`}>
              {s.temperatureC != null ? `${s.temperatureC.toFixed(1)}°C` : "—"}
            </p>
            <FreshnessBadge sensor={s} className="mt-0.5" />
            {(s.humidityPercent != null || s.breaching) && !s.stale && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {s.humidityPercent != null ? `${s.humidityPercent}% RH` : ""}
                {s.breaching ? " · over range" : ""}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Optional at-a-glance progress under the headline number. Purely visual —
 *  `done / total` with a slim bar so nobody has to click into the card to see
 *  where the day is up to. `barClass` matches the card's accent colour. */
type StatProgress = { done: number; total: number; label: string; barClass: string; hideDetail?: boolean };

/** "44 / 46" once work has started; just "46" while nothing's done yet. The
 *  fraction IS the headline — per Graeme, progress is the biggest detail on
 *  show, so it belongs in the big number rather than under the bar. */
function formatProgressValue(done: number, total: number): string {
  if (total <= 0) return "0";
  return done > 0 ? `${done} / ${total}` : total.toString();
}

/** In-bar label for the dispatch chart: just the number, big white and
 *  bold, sitting inside the top of the column (the legend blocks say which
 *  series is which — words in the bars were unreadable). Short bars can't
 *  hold it, so the number perches above them in the page colour instead. */
function renderBarLabel(props: any) {
  const { x, y, width, height, value } = props;
  if (!value) return null;
  const cx = x + width / 2;
  if ((height ?? 0) < 26) {
    return (
      <text x={cx} y={y - 5} textAnchor="middle" fontSize={14} fontWeight={800} fill="hsl(var(--foreground))">
        {value}
      </text>
    );
  }
  return (
    <text x={cx} y={y + 19} textAnchor="middle" fontSize={15} fontWeight={800} fill="#fff">
      {value}
    </text>
  );
}

function StatCard({ title, value, subtitle, icon: Icon, color, bg, href, progress }: any & { progress?: StatProgress }) {
  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : 0;
  return (
    <Link href={href} className="h-full">
      <div className="glass-panel rounded-2xl hover-lift cursor-pointer group h-full flex flex-col min-h-[150px] overflow-hidden">
        {/* The header IS the wayfinding: white-on-green (house rule for
            on-green text), big and top-of-card so the row scans at a
            glance (Graeme, 2026-08-18). */}
        <div className="bg-primary px-2 py-2">
          <p className="font-display font-bold text-white text-base lg:text-lg leading-tight text-center truncate">
            {title}
          </p>
        </div>
        <div className="p-4 pt-3 flex flex-col items-center text-center gap-2 flex-1 w-full">
        <div className={`p-2.5 rounded-2xl ${bg} ${color} transition-transform group-hover:scale-110`}>
          <Icon className="w-5 h-5" />
        </div>
        <h3 className="text-3xl font-display font-bold leading-none tabular-nums whitespace-nowrap">{value}</h3>
        {subtitle && (
          <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>
        )}
        {progress && progress.total > 0 && (
          <div className="w-full mt-auto pt-1">
            <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-emerald-500" : progress.barClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {!progress.hideDetail && (
              <p className="text-xs text-muted-foreground mt-1 tabular-nums leading-snug">
                {progress.done} / {progress.total} {progress.label}
              </p>
            )}
          </div>
        )}
        </div>
      </div>
    </Link>
  );
}
