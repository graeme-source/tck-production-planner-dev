import { useState } from "react";
import { useListProductionPlans, useListDispatchOrders, useGetProductionPlan } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { format, isToday, startOfWeek, addWeeks } from "date-fns";
import { ArrowRight, ChefHat, Truck, Package, RefreshCw, ChevronLeft, ChevronRight, PackageCheck, LineChart, Thermometer } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useQuery } from "@tanstack/react-query";

function TodayPlanRecipes({ planId }: { planId: number }) {
  const { data: plan, isLoading } = useGetProductionPlan(planId) as { data: any; isLoading: boolean };
  if (isLoading) return <p className="text-xs text-muted-foreground px-1">Loading…</p>;
  const items = (plan?.items ?? [])
    .filter((it: any) => (it.batchesTarget ?? 0) > 0)
    .sort((a: any, b: any) => a.orderPosition - b.orderPosition);
  if (items.length === 0) return <p className="text-xs text-muted-foreground px-1">No recipes with batches.</p>;
  return (
    <div className="space-y-1.5">
      {items.map((it: any) => (
        <div key={it.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-secondary/50 transition-colors">
          <span className="text-sm font-medium truncate pr-2" style={it.recipeColor ? { color: it.recipeColor } : undefined}>
            {it.recipeName ?? "Unknown"}
          </span>
          <span className="text-sm font-bold tabular-nums shrink-0" style={it.recipeColor ? { color: it.recipeColor } : undefined}>
            {it.batchesTarget} <span className="text-xs font-normal text-muted-foreground">batch{it.batchesTarget !== 1 ? "es" : ""}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

async function fetchTodayBatchCount(planIds: number[]): Promise<number> {
  if (planIds.length === 0) return 0;
  let total = 0;
  for (const id of planIds) {
    const res = await fetch(`${BASE}/api/production-plans/${id}`, { credentials: "include" });
    if (!res.ok) continue;
    const plan = await res.json();
    for (const it of plan.items ?? []) {
      total += it.batchesTarget ?? 0;
    }
  }
  return total;
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
  return (data.days ?? data) as { date: string; deliveryDate: string; day: string; orderCount: number; fulfilledCount: number; unfulfilledCount: number }[];
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
  const { state } = useAuth();
  const isFounder = state.status === "authenticated" && state.user.email === FOUNDER_EMAIL;
  const { data: plans } = useListProductionPlans();
  const { data: dispatches } = useListDispatchOrders();

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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Batches Today"
          value={batchesLoading ? "…" : (totalBatches ?? 0).toString()}
          icon={ChefHat}
          color="text-primary"
          bg="bg-primary/10"
          href="/plans"
        />
        <StatCard
          title="Dispatching Today"
          value={todayDispatches.length.toString()}
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
              onClick={() => refetch()}
              disabled={weeklyLoading}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${weeklyLoading ? "animate-spin" : ""}`} />
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

function StatCard({ title, value, icon: Icon, color, bg, href }: any) {
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
          </div>
        </div>
      </div>
    </Link>
  );
}
