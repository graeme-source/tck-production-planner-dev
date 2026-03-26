import { useState, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Redirect } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { format, startOfMonth, getDaysInMonth, subDays, subMonths, endOfMonth } from "date-fns";
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
  Tag,
  Plus,
  Trash2,
  X,
  Check,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

const CUSTOMER_TYPES = [
  { tag: "new-customer", label: "New Customers", icon: UserPlus, color: "text-blue-500", bg: "bg-blue-500/10" },
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
  dayCount,
  isActive,
  onClick,
  loading,
}: {
  type: (typeof CUSTOMER_TYPES)[number];
  count: number;
  dayCount: number;
  isActive: boolean;
  onClick: () => void;
  loading?: boolean;
}) {
  const { label, icon: Icon, color, bg } = type;
  const dailyAvg = dayCount > 1 ? (count / dayCount).toFixed(1) : null;
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
          <>
            <p className="text-2xl font-display font-bold">{count}</p>
            {dailyAvg !== null && (
              <p className="text-xs text-muted-foreground mt-0.5">Daily avg: {dailyAvg}</p>
            )}
          </>
        )}
      </div>
      <ChevronDown
        className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${isActive ? "rotate-180" : ""}`}
      />
    </button>
  );
}

// ── Custom Tag Panel types & helpers ──────────────────────────────────────────

interface SavedPanel {
  id: number;
  tag: string;
  label: string;
  created_at: string;
}

async function fetchSavedPanels(): Promise<SavedPanel[]> {
  const res = await fetch(`${BASE}/api/founder-panels`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load custom panels");
  return res.json();
}

async function fetchTagSummary(tag: string, from: string, to: string) {
  const params = new URLSearchParams({ tag, from, to });
  const res = await fetch(`${BASE}/api/shopify/tag-summary?${params}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch tag summary");
  return res.json() as Promise<{ count: number; totalValue: number }>;
}

async function createPanel(tag: string, label: string): Promise<SavedPanel> {
  const res = await fetch(`${BASE}/api/founder-panels`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag, label }),
  });
  if (!res.ok) throw new Error("Failed to create panel");
  return res.json();
}

async function deletePanel(id: number): Promise<void> {
  const res = await fetch(`${BASE}/api/founder-panels/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete panel");
}

// Individual custom panel card — queries its own tag-summary
function CustomPanelCard({
  panel,
  from,
  to,
  onDelete,
}: {
  panel: SavedPanel;
  from: string;
  to: string;
  onDelete: (id: number) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["tag-summary", panel.tag, from, to],
    queryFn: () => fetchTagSummary(panel.tag, from, to),
    staleTime: 5 * 60 * 1000,
  });

  function handleDeleteClick() {
    if (confirmDelete) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      onDelete(panel.id);
    } else {
      setConfirmDelete(true);
      confirmTimer.current = setTimeout(() => setConfirmDelete(false), 4000);
    }
  }

  return (
    <div className="glass-panel p-5 rounded-2xl flex flex-col gap-3 group relative">
      {/* Delete button */}
      <button
        onClick={handleDeleteClick}
        title={confirmDelete ? "Click again to confirm delete" : "Delete panel"}
        className={`absolute top-3 right-3 flex items-center gap-1 text-xs rounded-lg px-2 py-1 transition-all
          ${confirmDelete
            ? "bg-destructive text-destructive-foreground"
            : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          }`}
      >
        {confirmDelete ? (
          <>
            <Check className="w-3 h-3" />
            Confirm
          </>
        ) : (
          <Trash2 className="w-3.5 h-3.5" />
        )}
      </button>
      {confirmDelete && (
        <button
          onClick={() => setConfirmDelete(false)}
          className="absolute top-3 right-20 text-muted-foreground hover:text-foreground opacity-100 p-1"
          title="Cancel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Header */}
      <div className="flex items-start gap-3 pr-16">
        <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
          <Tag className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{panel.label}</p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{panel.tag}</p>
        </div>
      </div>

      {/* Stats */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-4 w-28" />
        </div>
      ) : error ? (
        <p className="text-destructive text-xs flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" /> Could not load
        </p>
      ) : (
        <div className="space-y-1">
          <p className="text-2xl font-display font-bold tabular-nums">{data?.count ?? 0}</p>
          <p className="text-xs text-muted-foreground">
            {formatGBP(data?.totalValue ?? 0)} total value
          </p>
        </div>
      )}
    </div>
  );
}

// Add-panel inline form
function AddPanelForm({ onAdd, onCancel }: { onAdd: (tag: string, label: string) => void; onCancel: () => void }) {
  const [tag, setTag] = useState("");
  const [label, setLabel] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = tag.trim();
    const l = label.trim() || t;
    if (!t) return;
    onAdd(t, l);
  }

  return (
    <form onSubmit={handleSubmit} className="glass-panel p-5 rounded-2xl border-2 border-primary/30 flex flex-col gap-3">
      <p className="text-sm font-semibold">Add Custom Tag Panel</p>
      <div className="space-y-2">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Shopify Tag <span className="text-destructive">*</span></label>
          <input
            autoFocus
            value={tag}
            onChange={e => setTag(e.target.value)}
            placeholder="e.g. new-customer"
            className="w-full text-sm bg-secondary border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            required
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Display Label <span className="text-muted-foreground">(optional)</span></label>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder={tag || "e.g. New Customers"}
            className="w-full text-sm bg-secondary border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!tag.trim()}
          className="flex items-center gap-1.5 text-sm font-medium bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          <Check className="w-4 h-4" /> Save Panel
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg hover:bg-secondary transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
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

// Build preset ranges at call time so they're always relative to now
function buildPresets() {
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");
  return [
    { label: "Today",          from: todayStr,                                              to: todayStr },
    { label: "Last 7 days",    from: format(subDays(today, 6), "yyyy-MM-dd"),               to: todayStr },
    { label: "Month to date",  from: format(startOfMonth(today), "yyyy-MM-dd"),             to: todayStr },
    { label: "Last month",     from: format(startOfMonth(subMonths(today, 1)), "yyyy-MM-dd"), to: format(endOfMonth(subMonths(today, 1)), "yyyy-MM-dd") },
    { label: "Last 6 months",  from: format(subMonths(today, 6), "yyyy-MM-dd"),             to: todayStr },
    { label: "Last 12 months", from: format(subMonths(today, 12), "yyyy-MM-dd"),            to: todayStr },
  ] as const;
}

function sectionHeading(text: string) {
  return (
    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
      {text}
    </h2>
  );
}

function FounderDashboard() {
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");
  const monthStart = format(startOfMonth(today), "yyyy-MM-dd");

  // ── Fixed date range: always this month → today ──────────────────────────
  const {
    data: monthSummary,
    isLoading: monthLoading,
    error: monthError,
    refetch: refetchMonth,
  } = useQuery({
    queryKey: ["founder-month-summary", monthStart, todayStr],
    queryFn: () => fetchSalesSummary(monthStart, todayStr),
    staleTime: 5 * 60 * 1000,
  });

  // ── Period state: default to Today ───────────────────────────────────────
  const [from, setFrom] = useState(todayStr);
  const [to, setTo]     = useState(todayStr);
  const [activePreset, setActivePreset] = useState("Today");

  function applyPreset(p: { label: string; from: string; to: string }) {
    setFrom(p.from);
    setTo(p.to);
    setActivePreset(p.label);
  }

  function handleManualDateChange(field: "from" | "to", val: string) {
    if (field === "from") setFrom(val);
    else setTo(val);
    setActivePreset("custom");
  }

  // ── Period queries ────────────────────────────────────────────────────────
  const {
    data: periodSummary,
    isLoading: periodLoading,
    error: periodError,
    refetch: refetchPeriod,
  } = useQuery({
    queryKey: ["founder-period-summary", from, to],
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

  // ── Order breakdown expand ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [expandedPanel, setExpandedPanel] = useState(false);

  function handleTypeClick(tag: string) {
    if (activeTab === tag && expandedPanel) setExpandedPanel(false);
    else { setActiveTab(tag); setExpandedPanel(true); }
  }

  // ── Custom panels ─────────────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const queryClient = useQueryClient();

  const { data: savedPanels = [] } = useQuery({
    queryKey: ["founder-custom-panels"],
    queryFn: fetchSavedPanels,
    staleTime: 60 * 1000,
  });

  const addMutation = useMutation({
    mutationFn: ({ tag, label }: { tag: string; label: string }) => createPanel(tag, label),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["founder-custom-panels"] }); setShowAddForm(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePanel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["founder-custom-panels"] }),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const isAnyLoading = monthLoading || periodLoading || orderTypesLoading;

  function handleRefresh() {
    refetchMonth();
    refetchPeriod();
    refetchOrderTypes();
  }

  function getGroupCount(tag: string) {
    return orderTypes?.groups.find((g) => g.tag === tag)?.count ?? 0;
  }
  function getGroupOrders(tag: string) {
    return orderTypes?.groups.find((g) => g.tag === tag)?.orders ?? [];
  }

  const presets = useMemo(() => buildPresets(), [todayStr]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      <PageHeader
        title="Founder View"
        description="Sales KPIs and order breakdown."
        action={
          <button
            onClick={handleRefresh}
            disabled={isAnyLoading}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 px-3 py-2 rounded-lg hover:bg-secondary"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAnyLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      {/* ── Section 1: Fixed At-a-Glance KPIs (always this month) ──────────── */}
      <section>
        {sectionHeading("At a Glance — " + format(today, "MMMM yyyy"))}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            title="Today's Sales"
            value={monthSummary ? formatGBP(monthSummary.todayRevenue) : "—"}
            sub={monthSummary ? `${monthSummary.todayOrderCount} order${monthSummary.todayOrderCount !== 1 ? "s" : ""} today` : undefined}
            icon={TrendingUp}
            color="text-primary"
            bg="bg-primary/10"
            loading={monthLoading}
            error={!!monthError}
          />
          <KpiCard
            title="This Month to Date"
            value={monthSummary ? formatGBP(monthSummary.totalRevenue) : "—"}
            sub={monthSummary ? `${monthSummary.orderCount} orders this month` : undefined}
            icon={BarChart2}
            color="text-blue-500"
            bg="bg-blue-500/10"
            loading={monthLoading}
            error={!!monthError}
          />
          <KpiCard
            title="Avg Daily Sales This Month"
            value={monthSummary ? formatGBP(monthSummary.averageDailyRevenue) : "—"}
            sub={monthSummary ? `Over ${monthSummary.dayCount} day${monthSummary.dayCount !== 1 ? "s" : ""} so far` : undefined}
            icon={Calculator}
            color="text-violet-500"
            bg="bg-violet-500/10"
            loading={monthLoading}
            error={!!monthError}
          />
          <KpiCard
            title="Est. Monthly Forecast"
            value={monthSummary ? formatGBP(monthSummary.estimatedMonthlyRevenue) : "—"}
            sub={`Based on ${getDaysInMonth(today)}-day month`}
            icon={Calendar}
            color="text-amber-500"
            bg="bg-amber-500/10"
            loading={monthLoading}
            error={!!monthError}
          />
        </div>
      </section>

      {/* ── Section 2: Period Picker + Period Sales ─────────────────────────── */}
      <section>
        {sectionHeading("Period Analysis")}

        {/* Picker row */}
        <div className="glass-panel p-4 rounded-2xl space-y-3 mb-5">
          {/* Preset buttons */}
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all border ${
                  activePreset === p.label
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Custom date inputs */}
          <div className="flex items-center gap-3 flex-wrap">
            <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">From</label>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => handleManualDateChange("from", e.target.value)}
                className="text-sm bg-secondary border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">To</label>
              <input
                type="date"
                value={to}
                min={from}
                max={todayStr}
                onChange={(e) => handleManualDateChange("to", e.target.value)}
                className="text-sm bg-secondary border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {periodError && (
              <p className="text-destructive text-sm flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {(periodError as Error).message}
              </p>
            )}
          </div>
        </div>

        {/* Period total sales */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <KpiCard
            title={`Total Sales — ${activePreset === "custom" ? `${from} to ${to}` : activePreset}`}
            value={periodSummary ? formatGBP(periodSummary.totalRevenue) : "—"}
            sub={periodSummary ? `${periodSummary.orderCount} orders` : undefined}
            icon={BarChart2}
            color="text-blue-500"
            bg="bg-blue-500/10"
            loading={periodLoading}
            error={!!periodError}
          />
        </div>

        {/* Order breakdown */}
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Order Breakdown</h3>
        {orderTypesError && (
          <div className="glass-panel rounded-2xl p-5 flex items-center gap-3 text-destructive mb-4">
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
              dayCount={periodSummary?.dayCount ?? 1}
              isActive={activeTab === type.tag && expandedPanel}
              onClick={() => handleTypeClick(type.tag)}
              loading={orderTypesLoading}
            />
          ))}
        </div>

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

      {/* ── Section 3: Custom Tag Panels ────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          {sectionHeading("Custom Tag Panels")}
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 border border-primary/30 hover:border-primary/60 rounded-lg px-3 py-1.5 transition-colors -mt-4"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Panel
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {showAddForm && (
            <AddPanelForm
              onAdd={(tag, label) => addMutation.mutate({ tag, label })}
              onCancel={() => setShowAddForm(false)}
            />
          )}
          {savedPanels.map((panel) => (
            <CustomPanelCard
              key={panel.id}
              panel={panel}
              from={from}
              to={to}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          ))}
          {!showAddForm && savedPanels.length === 0 && (
            <div className="sm:col-span-2 xl:col-span-4 glass-panel rounded-2xl p-8 text-center text-muted-foreground">
              <Tag className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No custom panels yet. Click <strong>Add Panel</strong> to track any Shopify tag.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
