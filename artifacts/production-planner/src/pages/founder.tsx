import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { format, startOfMonth, getDaysInMonth } from "date-fns";
import {
  TrendingUp,
  Calendar,
  BarChart2,
  Calculator,
  RefreshCw,
  ChevronDown,
  ShoppingBag,
  Repeat,
  UserPlus,
  Package,
  AlertCircle,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

const CUSTOMER_TYPES = [
  { tag: "New Customer", label: "New Customers", icon: UserPlus, color: "text-blue-500", bg: "bg-blue-500/10" },
  { tag: "Subscription Recurring Order", label: "Recurring Subscriptions", icon: Repeat, color: "text-violet-500", bg: "bg-violet-500/10" },
  { tag: "Subscription New Order", label: "New Subscriptions", icon: ShoppingBag, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { tag: "Wholesale", label: "Wholesale", icon: Package, color: "text-amber-500", bg: "bg-amber-500/10" },
] as const;

function formatGBP(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getDefaultDateRange(): { from: string; to: string } {
  const today = new Date();
  const from = format(startOfMonth(today), "yyyy-MM-dd");
  const to = format(today, "yyyy-MM-dd");
  return { from, to };
}

async function fetchSalesSummary(from: string, to: string) {
  const res = await fetch(
    `${BASE}/api/shopify/sales-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{
    from: string;
    to: string;
    totalRevenue: number;
    orderCount: number;
    dayCount: number;
    averageDailyRevenue: number;
    estimatedMonthlyRevenue: number;
    todayRevenue: number;
    todayOrderCount: number;
  }>;
}

async function fetchOrdersByType(from: string, to: string) {
  const res = await fetch(
    `${BASE}/api/shopify/orders-by-type?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{
    from: string;
    to: string;
    groups: Array<{
      tag: string;
      count: number;
      orders: Array<{
        id: number;
        orderNumber: string;
        customerName: string;
        date: string;
        total: number;
        fulfillmentStatus: string;
      }>;
    }>;
  }>;
}

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  color,
  bg,
  loading,
  error,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  loading?: boolean;
  error?: boolean;
}) {
  return (
    <div className="glass-panel p-6 rounded-2xl flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className={`p-3 rounded-xl ${bg} ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
      </div>
      {loading ? (
        <Skeleton className="h-9 w-40" />
      ) : error ? (
        <p className="text-destructive text-sm flex items-center gap-1">
          <AlertCircle className="w-4 h-4" /> Error
        </p>
      ) : (
        <>
          <p className="text-3xl font-display font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </>
      )}
    </div>
  );
}

function FulfillmentBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "fulfilled") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        Fulfilled
      </span>
    );
  }
  if (s === "partial") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
        Partial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
      Unfulfilled
    </span>
  );
}

function OrderTable({
  orders,
}: {
  orders: Array<{
    id: number;
    orderNumber: string;
    customerName: string;
    date: string;
    total: number;
    fulfillmentStatus: string;
  }>;
}) {
  if (orders.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        No orders in this period.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              Order
            </th>
            <th className="text-left py-3 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              Customer
            </th>
            <th className="text-left py-3 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              Date
            </th>
            <th className="text-right py-3 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              Total
            </th>
            <th className="text-right py-3 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.id}
              className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
            >
              <td className="py-3 px-4 font-medium text-primary">{order.orderNumber}</td>
              <td className="py-3 px-4">{order.customerName}</td>
              <td className="py-3 px-4 text-muted-foreground">
                {format(new Date(order.date + "T00:00:00"), "d MMM yyyy")}
              </td>
              <td className="py-3 px-4 text-right font-medium tabular-nums">
                {formatGBP(order.total)}
              </td>
              <td className="py-3 px-4 text-right">
                <FulfillmentBadge status={order.fulfillmentStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderTypeCard({
  type,
  count,
  isActive,
  onClick,
  loading,
}: {
  type: (typeof CUSTOMER_TYPES)[number];
  count: number;
  isActive: boolean;
  onClick: () => void;
  loading?: boolean;
}) {
  const { label, icon: Icon, color, bg } = type;
  return (
    <button
      onClick={onClick}
      className={`glass-panel p-5 rounded-2xl flex items-center gap-4 text-left w-full hover-lift transition-all cursor-pointer
        ${isActive ? "ring-2 ring-primary" : "ring-0"}`}
    >
      <div className={`p-3 rounded-xl ${bg} ${color} shrink-0`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-muted-foreground truncate">{label}</p>
        {loading ? (
          <Skeleton className="h-7 w-12 mt-1" />
        ) : (
          <p className="text-2xl font-display font-bold">{count}</p>
        )}
      </div>
      <ChevronDown
        className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${isActive ? "rotate-180" : ""}`}
      />
    </button>
  );
}

export default function FounderView() {
  const { state } = useAuth();

  if (state.status === "loading") return null;
  if (state.status !== "authenticated" || state.user.email !== FOUNDER_EMAIL) {
    return <Redirect to="/" />;
  }

  return <FounderDashboard />;
}

function FounderDashboard() {
  const defaults = useMemo(() => getDefaultDateRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [expandedPanel, setExpandedPanel] = useState(false);

  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["founder-sales-summary", from, to],
    queryFn: () => fetchSalesSummary(from, to),
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: orderTypes,
    isLoading: orderTypesLoading,
    error: orderTypesError,
    refetch: refetchOrderTypes,
  } = useQuery({
    queryKey: ["founder-orders-by-type", from, to],
    queryFn: () => fetchOrdersByType(from, to),
    staleTime: 5 * 60 * 1000,
  });

  function handleTypeClick(tag: string) {
    if (activeTab === tag && expandedPanel) {
      setExpandedPanel(false);
    } else {
      setActiveTab(tag);
      setExpandedPanel(true);
    }
  }

  function handleRefresh() {
    refetchSummary();
    refetchOrderTypes();
  }

  const isLoading = summaryLoading || orderTypesLoading;

  function getGroupCount(tag: string): number {
    if (!orderTypes) return 0;
    return orderTypes.groups.find((g) => g.tag === tag)?.count ?? 0;
  }

  function getGroupOrders(tag: string) {
    if (!orderTypes) return [];
    return orderTypes.groups.find((g) => g.tag === tag)?.orders ?? [];
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Founder View"
        description="Sales KPIs and order breakdown for the selected period."
        action={
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 px-3 py-2 rounded-lg hover:bg-secondary"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      {/* Date Range Picker */}
      <div className="glass-panel p-4 rounded-2xl flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Period</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">From</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="text-sm bg-secondary border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">To</label>
            <input
              type="date"
              value={to}
              min={from}
              max={format(new Date(), "yyyy-MM-dd")}
              onChange={(e) => setTo(e.target.value)}
              className="text-sm bg-secondary border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
        {summaryError && (
          <p className="text-destructive text-sm flex items-center gap-1 ml-auto">
            <AlertCircle className="w-4 h-4" />
            {(summaryError as Error).message}
          </p>
        )}
      </div>

      {/* Section 1: Sales KPIs */}
      <section>
        <h2 className="text-base font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wide text-xs">
          Sales KPIs
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            title="Today's Sales"
            value={summary ? formatGBP(summary.todayRevenue) : "—"}
            sub={summary ? `${summary.todayOrderCount} orders today` : undefined}
            icon={TrendingUp}
            color="text-primary"
            bg="bg-primary/10"
            loading={summaryLoading}
            error={!!summaryError}
          />
          <KpiCard
            title="Sales This Period"
            value={summary ? formatGBP(summary.totalRevenue) : "—"}
            sub={summary ? `${summary.orderCount} orders` : undefined}
            icon={BarChart2}
            color="text-blue-500"
            bg="bg-blue-500/10"
            loading={summaryLoading}
            error={!!summaryError}
          />
          <KpiCard
            title="Average Daily Sales"
            value={summary ? formatGBP(summary.averageDailyRevenue) : "—"}
            sub={summary ? `Over ${summary.dayCount} day${summary.dayCount !== 1 ? "s" : ""}` : undefined}
            icon={Calculator}
            color="text-violet-500"
            bg="bg-violet-500/10"
            loading={summaryLoading}
            error={!!summaryError}
          />
          <KpiCard
            title="Est. Monthly Sales"
            value={summary ? formatGBP(summary.estimatedMonthlyRevenue) : "—"}
            sub={`Based on ${getDaysInMonth(new Date())}-day month`}
            icon={Calendar}
            color="text-amber-500"
            bg="bg-amber-500/10"
            loading={summaryLoading}
            error={!!summaryError}
          />
        </div>
      </section>

      {/* Section 2: Order Breakdown */}
      <section>
        <h2 className="text-base font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wide text-xs">
          Order Breakdown
        </h2>
        {orderTypesError && (
          <div className="glass-panel rounded-2xl p-6 flex items-center gap-3 text-destructive mb-4">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm">{(orderTypesError as Error).message}</p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {CUSTOMER_TYPES.map((type) => (
            <OrderTypeCard
              key={type.tag}
              type={type}
              count={getGroupCount(type.tag)}
              isActive={activeTab === type.tag && expandedPanel}
              onClick={() => handleTypeClick(type.tag)}
              loading={orderTypesLoading}
            />
          ))}
        </div>

        {/* Expanded Order Panel */}
        {expandedPanel && activeTab && (
          <div className="glass-panel rounded-2xl mt-4 overflow-hidden">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="border-b border-border px-4 pt-4">
                <TabsList className="bg-transparent gap-1 flex-wrap h-auto">
                  {CUSTOMER_TYPES.map((type) => (
                    <TabsTrigger
                      key={type.tag}
                      value={type.tag}
                      className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg"
                    >
                      {type.label}
                      <span className="ml-1.5 tabular-nums text-[10px] opacity-70">
                        ({getGroupCount(type.tag)})
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              {CUSTOMER_TYPES.map((type) => (
                <TabsContent key={type.tag} value={type.tag} className="m-0">
                  {orderTypesLoading ? (
                    <div className="p-6 space-y-3">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : (
                    <OrderTable orders={getGroupOrders(type.tag)} />
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}
      </section>
    </div>
  );
}
