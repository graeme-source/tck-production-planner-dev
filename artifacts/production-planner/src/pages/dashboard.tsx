import { useListProductionPlans, useListStockEntries, useListDispatchOrders, useListSalesEntries } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { format, isToday, isFuture } from "date-fns";
import { ArrowRight, AlertTriangle, ChefHat, Truck, TrendingUp, Package, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useQuery } from "@tanstack/react-query";

async function fetchWeeklyOrders() {
  const res = await fetch("/api/shopify/weekly-orders", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch weekly orders");
  const data = await res.json();
  return (data.days ?? data) as { date: string; deliveryDate: string; day: string; orderCount: number; fulfilledCount: number; unfulfilledCount: number }[];
}

export default function Dashboard() {
  const { data: plans } = useListProductionPlans();
  const { data: stock } = useListStockEntries();
  const { data: dispatches } = useListDispatchOrders();
  const { data: sales } = useListSalesEntries();

  const { data: weeklyOrders, isLoading: weeklyLoading, error: weeklyError, refetch } = useQuery({
    queryKey: ["shopify-weekly-orders"],
    queryFn: fetchWeeklyOrders,
    staleTime: 5 * 60 * 1000,
  });

  const todayPlans = plans?.filter(p => isToday(new Date(p.planDate))) || [];
  const lowStock = stock?.filter(s => s.quantity < 10) || [];
  const upcomingDispatches = dispatches?.filter(d => isFuture(new Date(d.dispatchDate)) && d.status === 'pending') || [];

  const todayTag = format(new Date(), "yyyy-MM-dd");
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
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Today's Plans"
          value={todayPlans.length.toString()}
          icon={ChefHat}
          color="text-primary"
          bg="bg-primary/10"
          href="/plans"
        />
        <StatCard
          title="Low Stock Items"
          value={lowStock.length.toString()}
          icon={AlertTriangle}
          color="text-accent"
          bg="bg-accent/10"
          href="/stock"
        />
        <StatCard
          title="Pending Dispatches"
          value={upcomingDispatches.length.toString()}
          icon={Truck}
          color="text-blue-500"
          bg="bg-blue-500/10"
          href="/dispatches"
        />
        <StatCard
          title="Recent Sales"
          value={sales?.length.toString() || "0"}
          icon={TrendingUp}
          color="text-emerald-500"
          bg="bg-emerald-500/10"
          href="/sales"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        <div className="lg:col-span-2 glass-panel p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-display font-bold text-lg">Dispatch Orders — Next 7 Days</h3>
              <p className="text-sm text-muted-foreground mt-0.5">Shopify orders tagged by delivery date</p>
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
            <div className="flex gap-4 mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground">
                  {weeklyOrders.reduce((s, d) => s + d.orderCount, 0)}
                </span>{" "}
                total orders this week
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

        <div className="glass-panel rounded-2xl flex flex-col">
          <div className="p-6 border-b border-border">
            <h3 className="font-display font-bold text-lg">Today's Production</h3>
          </div>
          <div className="p-4 flex-1 overflow-y-auto space-y-3">
            {todayPlans.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-8">
                <Package className="w-12 h-12 mb-2 opacity-20" />
                <p>No plans for today.</p>
              </div>
            ) : (
              todayPlans.map(plan => (
                <div key={plan.id} className="p-4 rounded-xl bg-secondary/50 border border-border/50 hover-lift">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-semibold">{plan.name}</h4>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${plan.status === 'completed' ? 'bg-primary/20 text-primary' : 'bg-accent/20 text-accent'}`}>
                      {plan.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-1">{plan.notes || "No notes"}</p>
                </div>
              ))
            )}
          </div>
          <div className="p-4 border-t border-border">
            <Link href="/plans" className="text-sm font-medium text-primary flex items-center justify-center gap-1 hover:underline">
              View all plans <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color, bg, href }: any) {
  return (
    <Link href={href}>
      <div className="glass-panel p-6 rounded-2xl hover-lift cursor-pointer group">
        <div className="flex items-center gap-4">
          <div className={`p-4 rounded-2xl ${bg} ${color} transition-transform group-hover:scale-110`}>
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
            <h3 className="text-3xl font-display font-bold">{value}</h3>
          </div>
        </div>
      </div>
    </Link>
  );
}
