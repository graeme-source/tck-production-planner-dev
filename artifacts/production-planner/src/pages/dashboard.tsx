import { useState, useEffect, useRef } from "react";
import { useListProductionPlans, useListDispatchOrders, useGetProductionPlan } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { useRefreshSpin } from "@/hooks/use-refresh-spin";
import { format, isToday, startOfWeek, addWeeks } from "date-fns";
import { ArrowRight, ChefHat, Truck, Package, RefreshCw, ChevronLeft, ChevronRight, PackageCheck, LineChart, Thermometer, AlertTriangle, CheckCircle, X } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { compareItemsForDisplay } from "@/pages/station/shared/constants";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

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
 *  conflated with mac cheese packs (1 mac batch = 1 pack). */
async function fetchTodayBatchCount(planIds: number[]): Promise<{ calzoneBatches: number; macPacks: number }> {
  if (planIds.length === 0) return { calzoneBatches: 0, macPacks: 0 };
  let calzoneBatches = 0;
  let macPacks = 0;
  for (const id of planIds) {
    const res = await fetch(`${BASE}/api/production-plans/${id}`, { credentials: "include" });
    if (!res.ok) continue;
    const plan = await res.json();
    for (const it of plan.items ?? []) {
      const target = it.batchesTarget ?? 0;
      if (it.recipeCategory === MAC_CHEESE_CATEGORY) macPacks += target;
      else calzoneBatches += target;
    }
  }
  return { calzoneBatches, macPacks };
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

async function fetchTodayDeliveriesCount(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  const res = await fetch(`${BASE}/api/deliveries/weekly?weekOf=${today}`, { credentials: "include" });
  if (!res.ok) return 0;
  const data = await res.json();
  const orders = data.orders ?? data ?? [];
  return orders.filter((o: any) => o.expectedDeliveryDate === today).length;
}

const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

export default function Dashboard() {
  const dashRefresh = useRefreshSpin();
  const { state } = useAuth();
  const isFounder = state.status === "authenticated" && state.user.email === FOUNDER_EMAIL;
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

  const { data: weeklyOrders, isLoading: weeklyLoading, error: weeklyError, refetch } = useQuery({
    queryKey: ["shopify-weekly-orders-dashboard", weekStartStr],
    queryFn: () => fetchWeeklyOrders(weekStartStr),
    staleTime: 5 * 60 * 1000,
  });

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

  const todayTag = format(today, "yyyy-MM-dd");
  const todayIndex = weeklyOrders?.findIndex(d => d.date === todayTag) ?? -1;
  const todayShopifyOrderCount = todayIndex >= 0 ? weeklyOrders![todayIndex].orderCount : null;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      return (
        <div className="bg-card border border-border rounded-xl px-4 py-3 shadow-lg text-sm space-y-1">
          <p className="font-semibold">Dispatch: {item.date}</p>
          <p className="text-muted-foreground text-xs">Delivery: {item.deliveryDate}</p>
          <p className="font-bold pt-1">{item.orderCount} total orders</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            <span>{item.fulfilledCount} fulfilled</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(var(--primary) / 0.3)" }} />
            <span>{item.unfulfilledCount} unfulfilled</span>
          </div>
          <p className="text-xs text-muted-foreground pt-1">{item.packCount} packs total</p>
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
          isFounder ? (
            <Link href="/founder">
              <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-secondary transition-colors">
                <LineChart className="w-3.5 h-3.5" />
                Founder View
              </button>
            </Link>
          ) : undefined
        }
      />

      {showIssueBanner && <AndonBanner userRole={userRole} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Batches Today"
          value={batchesLoading ? "…" : (totalBatches?.calzoneBatches ?? 0).toString()}
          subtitle={!batchesLoading && (totalBatches?.macPacks ?? 0) > 0
            ? `+ ${totalBatches!.macPacks} mac packs`
            : undefined}
          icon={ChefHat}
          color="text-primary"
          bg="bg-primary/10"
          href={todayPlans.length > 0 ? `/plans?planId=${todayPlans[0].id}` : "/plans"}
        />
        <StatCard
          title="Dispatching Today"
          value={weeklyLoading ? "…" : (todayShopifyOrderCount ?? todayDispatches.length).toString()}
          icon={Truck}
          color="text-blue-500"
          bg="bg-blue-500/10"
          href="/dispatches"
        />
        <StatCard
          title="Deliveries Arriving"
          value={(todayDeliveriesCount ?? 0).toString()}
          icon={PackageCheck}
          color="text-emerald-500"
          bg="bg-emerald-500/10"
          href="/deliveries"
        />
        <StatCard
          title="Current Factory Number"
          value={stockControlData == null ? "…" : (stockControlData.productionFridgeTotal ?? 0).toLocaleString()}
          icon={Thermometer}
          color="text-cyan-500"
          bg="bg-cyan-500/10"
          href="/stock-control"
        />
      </div>

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
              <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" /> Fulfilled</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "hsl(var(--primary) / 0.3)" }} /> Unfulfilled</span>
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

          <div className="h-[300px] w-full">
            {weeklyLoading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                <span className="text-sm">Fetching Shopify orders…</span>
              </div>
            ) : weeklyError ? (
              <div className="flex items-center justify-center h-full text-destructive text-sm">
                Could not load order data. Check Shopify connection.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyOrders} barSize={36}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="day"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    height={36}
                    interval={0}
                    tick={(props: { x: number; y: number; payload: { value: string } }) => {
                      const day = props.payload.value;
                      const row = weeklyOrders?.find(d => d.day === day);
                      return (
                        <g transform={`translate(${props.x},${props.y})`}>
                          <text x={0} y={0} dy={12} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={12}>{day}</text>
                          <text x={0} y={0} dy={26} textAnchor="middle" fill="hsl(var(--foreground))" fontSize={11} fontWeight={600}>{row?.packCount ?? 0}</text>
                        </g>
                      );
                    }}
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
                  <Bar dataKey="fulfilledCount" stackId="orders" fill="hsl(142 71% 45%)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="unfulfilledCount" stackId="orders" radius={[6, 6, 0, 0]}>
                    {weeklyOrders?.map((entry, i) => (
                      <Cell
                        key={entry.date}
                        fill={i === todayIndex ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.3)"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
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
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon: Icon, color, bg, href }: any) {
  return (
    <Link href={href} className="h-full">
      <div className="glass-panel p-6 rounded-2xl hover-lift cursor-pointer group h-full flex flex-col justify-between min-h-[110px]">
        <div className="flex items-start gap-4">
          <div className={`p-4 rounded-2xl ${bg} ${color} transition-transform group-hover:scale-110 shrink-0`}>
            <Icon className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground leading-snug mb-2">{title}</p>
            <h3 className="text-3xl font-display font-bold">{value}</h3>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
