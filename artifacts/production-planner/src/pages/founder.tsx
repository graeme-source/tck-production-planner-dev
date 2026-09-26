import { Fragment, useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Redirect } from "wouter";
import { useQuery, useMutation, useQueryClient, useIsFetching } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { useRefreshSpin } from "@/hooks/use-refresh-spin";
import { format, startOfMonth, getDaysInMonth, formatDistanceToNow } from "date-fns";
import {
  TrendingUp,
  Calendar,
  BarChart2,
  Calculator,
  ChefHat,
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
  Megaphone,
  Pencil,
  Percent,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  addDays,
  customWindow,
  DEFAULT_PERIOD,
  PERIOD_PRESETS,
  periodWindow,
  windowRoas,
  type PeriodPresetId,
  type PeriodWindow,
  type RoasResult,
} from "@/lib/roas";
import { revenueForTags } from "@/lib/order-type-totals";
import { SalesTrendPanel, TrendChip } from "@/components/sales-trend-panel";
import { DispatchOrdersPanel } from "@/components/dispatch-orders-panel";
import type { TrendMetricId } from "@/lib/sales-trend-view";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

const CUSTOMER_TYPES = [
  { id: "newCustomer", tag: "new-customer", label: "New Customers", icon: UserPlus, color: "text-blue-500", bg: "bg-blue-500/10" },
  { id: "recurringSub", tag: "Subscription Recurring Order", label: "Recurring Subscriptions", icon: Repeat, color: "text-violet-500", bg: "bg-violet-500/10" },
  { id: "newSub", tag: "Subscription New Order", label: "New Subscriptions", icon: ShoppingBag, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { id: "wholesale", tag: "wholesale", label: "Wholesale", icon: Package, color: "text-amber-500", bg: "bg-amber-500/10" },
] as const;

type CustomerTypeId = (typeof CUSTOMER_TYPES)[number]["id"];

function customerType(id: CustomerTypeId): (typeof CUSTOMER_TYPES)[number] {
  const found = CUSTOMER_TYPES.find((t) => t.id === id);
  if (!found) throw new Error(`Unknown customer type: ${id}`);
  return found;
}

/** The two tags that together make up "subscription revenue". Named here
 *  once so the tile and any future use can't drift apart. */
const SUBSCRIPTION_TAGS = [customerType("recurringSub").tag, customerType("newSub").tag] as const;

// Wholesale has no tile of its own (Graeme, 2026-09-18 — "not interested in
// it for now"), but it stays in CUSTOMER_TYPES: it is still fetched, still
// counted, and still reachable as a tab in the order breakdown, so putting
// the tile back is a one-line change rather than a re-import.

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
    /** Orders with revenue above £0 — AOV's divisor (£0 resends left out). */
    paidOrderCount: number;
    /** totalRevenue ÷ paidOrderCount; null with no paid orders. */
    aov: number | null;
    dayCount: number;
    averageDailyRevenue: number;
    estimatedMonthlyRevenue: number;
    todayRevenue: number;
    todayOrderCount: number;
    todayPaidOrderCount: number;
    todayAov: number | null;
  }>;
}

/** The AOV tiles' sub-line: what the figure is divided out of. */
function aovSub(revenue: number, paidOrders: number, none: string): string {
  if (paidOrders <= 0) return none;
  return `${formatGBP(revenue)} ÷ ${paidOrders} paid order${paidOrders !== 1 ? "s" : ""}`;
}

async function fetchConversion(from: string, to: string) {
  const res = await fetch(
    `${BASE}/api/shopify/conversion?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{
    from: string;
    to: string;
    sessions: number | null;
    orderCount: number | null;
    conversionRate: number | null;
  }>;
}

/** Every recorded day of ad spend across a span. Days with nothing recorded
 *  are ABSENT from `days` — not returned as zero — so the rolling ROAS can
 *  tell "we spent nothing" from "nobody has told us yet". */
async function fetchAdSpendRange(from: string, to: string) {
  const res = await fetch(
    `${BASE}/api/founder-focus/ad-spend/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{
    from: string;
    to: string;
    days: Array<{
      date: string;
      amount: number | null;
      source: "manual" | "meta" | null;
      syncedAt: string | null;
    }>;
  }>;
}

interface MetaSyncRecord {
  ok: boolean;
  ranAt: string;
  message: string;
  error: string | null;
  inserted: number;
  updated: number;
  skippedManual: number;
  timezone: { aligned: boolean; warning: string | null } | null;
}

/** Whether the Meta ad account is wired up, and what the last sync did.
 *  Always 200 — "not connected" is a state to show, not an error. */
async function fetchMetaStatus() {
  const res = await fetch(`${BASE}/api/meta-ads/status`, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{
    connected: boolean;
    accountId: string | null;
    message: string | null;
    reportingTimezone: string;
    lastSync: MetaSyncRecord | null;
  }>;
}

async function refreshFromMeta() {
  const res = await fetch(`${BASE}/api/meta-ads/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<MetaSyncRecord & { connected: boolean }>;
}

async function saveAdSpend(date: string, amount: number | null) {
  const res = await fetch(`${BASE}/api/founder-focus/ad-spend`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, amount }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ date: string; amount: number | null }>;
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

/** A tile's trend graph switch: open state and how to flip it. */
interface TrendToggle {
  open: boolean;
  onToggle: () => void;
}

/**
 * The outer shell of a tile. With a trend toggle the whole tile becomes the
 * button that opens its graph (a big target for an iPad thumb), with the
 * "Trend" chip showing that it can; without one it's the plain panel it was.
 */
/** The Trend button on its own line at the foot of a tile, so it never
 *  squeezes the title or figure above it (Graeme, 2026-09-26). mt-auto keeps
 *  the buttons level across tiles of different heights in the same row. */
function TrendFooter({ trend }: { trend?: TrendToggle }) {
  if (!trend) return null;
  return (
    <div className="mt-auto pt-1">
      <TrendChip open={trend.open} />
    </div>
  );
}

function TileShell({ trend, className, children }: { trend?: TrendToggle; className: string; children: React.ReactNode }) {
  if (!trend) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      onClick={trend.onToggle}
      aria-expanded={trend.open}
      className={`${className} text-left w-full hover-lift transition-all cursor-pointer ${trend.open ? "ring-2 ring-primary" : "ring-0"}`}
    >
      {children}
    </button>
  );
}

/**
 * One ROAS figure, in the same shape as the other tiles in the block.
 *
 * The whole point of this component is the unavailable branch. It shows an
 * em-dash and the reason, never a 0% — "the ads made nothing" and "nobody
 * has told us what we spent" look identical as a number and could not be
 * further apart as a decision.
 */
function RoasTile({
  title,
  result,
  loading,
  windowLabel,
  trend,
}: {
  title: string;
  result: RoasResult;
  loading?: boolean;
  /** e.g. "11 Sep – 17 Sep", shown so the window is never in doubt. */
  windowLabel?: string;
  trend?: TrendToggle;
}) {
  return (
    <TileShell trend={trend} className="glass-panel p-5 rounded-2xl flex flex-col gap-3">
      <div className="flex items-center gap-4">
      <div className="p-3 rounded-xl bg-pink-500/10 text-pink-500 shrink-0">
        <Percent className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-muted-foreground truncate">{title}</p>
        {loading ? (
          <Skeleton className="h-7 w-16 mt-1" />
        ) : result.available ? (
          <>
            <p className="text-2xl font-display font-bold">{result.percent}%</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {formatGBP(result.revenue)} ÷ {formatGBP(result.spend)} spend
            </p>
          </>
        ) : (
          <>
            <p className="text-2xl font-display font-bold text-muted-foreground">—</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate" title={result.reason}>
              {result.reason}
            </p>
          </>
        )}
        {windowLabel && <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">{windowLabel}</p>}
      </div>
      </div>
      <TrendFooter trend={trend} />
    </TileShell>
  );
}

/**
 * A money figure for the selected period, in the same shape as the tiles
 * around it. `null` means the orders haven't loaded — shown as a dash, not
 * as £0.00, for the same reason the ROAS tile refuses to print a 0%.
 */
function MoneyTile({
  title,
  value,
  sub,
  icon: Icon,
  color,
  bg,
  loading,
  trend,
}: {
  title: string;
  value: number | null;
  sub?: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  loading?: boolean;
  trend?: TrendToggle;
}) {
  return (
    <TileShell trend={trend} className="glass-panel p-5 rounded-2xl flex flex-col gap-3">
      <div className="flex items-center gap-4">
      <div className={`p-3 rounded-xl ${bg} ${color} shrink-0`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-muted-foreground truncate">{title}</p>
        {loading ? (
          <Skeleton className="h-7 w-20 mt-1" />
        ) : (
          <>
            <p className={`text-2xl font-display font-bold ${value == null ? "text-muted-foreground" : ""}`}>
              {value == null ? "—" : formatGBP(value)}
            </p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
          </>
        )}
      </div>
      </div>
      <TrendFooter trend={trend} />
    </TileShell>
  );
}

function KpiCard({
  title,
  qualifier,
  value,
  sub,
  icon: Icon,
  color,
  bg,
  loading,
  error,
  trend,
}: {
  title: string;
  /** Small grey words under the title that pin down what it means, e.g.
   *  "Sales this month" under "Average Daily". */
  qualifier?: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  loading?: boolean;
  error?: boolean;
  trend?: TrendToggle;
}) {
  return (
    <TileShell trend={trend} className="glass-panel p-6 rounded-2xl flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className={`p-3 rounded-xl ${bg} ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        {/* Big and bold enough to read at a glance alongside the figure
            (Graeme, 2026-09-26: "all I see is the big, bold numbers"). */}
        <div className="flex-1 min-w-0">
          <p className="text-lg font-display font-bold leading-tight">{title}</p>
          {qualifier && <p className="text-xs text-muted-foreground mt-0.5">{qualifier}</p>}
        </div>
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
      <TrendFooter trend={trend} />
    </TileShell>
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
  trend,
}: {
  type: (typeof CUSTOMER_TYPES)[number];
  count: number;
  dayCount: number;
  isActive: boolean;
  onClick: () => void;
  loading?: boolean;
  /** The count's graph, on its own chip — tapping the tile still opens the orders. */
  trend?: TrendToggle;
}) {
  const { label, icon: Icon, color, bg } = type;
  const dailyAvg = dayCount > 1 ? (count / dayCount).toFixed(1) : null;
  return (
    <div
      className={`glass-panel rounded-2xl flex flex-col w-full hover-lift transition-all
        ${isActive || trend?.open ? "ring-2 ring-primary" : "ring-0"}`}
    >
    <button
      onClick={onClick}
      aria-expanded={isActive}
      className="p-5 pb-3 w-full min-w-0 flex items-center gap-4 text-left cursor-pointer"
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
    {trend && (
      <div className="px-5 pb-4 mt-auto">
        <TrendChip open={trend.open} onClick={trend.onToggle} />
      </div>
    )}
    </div>
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

/** A period's days spelled out for a human — "Wed 17 Sep", or a range. */
function describePeriod(period: PeriodWindow): string {
  if (period.empty) return "No complete days yet";
  const day = (d: string) => format(new Date(`${d}T12:00:00`), "EEE d MMM");
  if (period.dayCount === 1) return day(period.from);
  return `${day(period.from)} – ${day(period.to)} · ${period.dayCount} days`;
}

function sectionHeading(text: string) {
  return (
    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
      {text}
    </h2>
  );
}

function FounderDashboard() {
  const founderRefresh = useRefreshSpin();
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");
  const monthStart = format(startOfMonth(today), "yyyy-MM-dd");

  // ── Fixed date range: always this month → today ──────────────────────────
  const {
    data: monthSummary,
    isLoading: monthLoading,
    isFetching: monthFetching,
    error: monthError,
    refetch: refetchMonth,
    dataUpdatedAt: monthUpdatedAt,
  } = useQuery({
    queryKey: ["founder-month-summary", monthStart, todayStr],
    queryFn: () => fetchSalesSummary(monthStart, todayStr),
    staleTime: 5 * 60 * 1000,
  });

  // ── Period state — ONE selection drives every tile below ─────────────────
  // Yesterday is the default: it is the most recent period that has actually
  // finished, so it is the first honest read of the day. Today is offered
  // next to it, clearly labelled as still running.
  const [periodId, setPeriodId] = useState<PeriodPresetId | "custom">(DEFAULT_PERIOD);
  const [customFrom, setCustomFrom] = useState(() => periodWindow(DEFAULT_PERIOD, new Date()).from);
  const [customTo, setCustomTo] = useState(() => periodWindow(DEFAULT_PERIOD, new Date()).to);

  const period = useMemo(
    () => (periodId === "custom" ? customWindow(customFrom, customTo, today) : periodWindow(periodId, today)),
    // todayStr, not `today`: a new Date() every render would rebuild this
    // constantly, but the window only moves when the London day does.
    [periodId, customFrom, customTo, todayStr],
  );
  const from = period.from;
  const to = period.to;

  function applyPreset(id: PeriodPresetId) {
    const win = periodWindow(id, new Date());
    setCustomFrom(win.from);
    setCustomTo(win.to);
    setPeriodId(id);
  }

  function handleManualDateChange(field: "from" | "to", val: string) {
    if (field === "from") setCustomFrom(val);
    else setCustomTo(val);
    setPeriodId("custom");
  }

  // ── Period queries — all four keyed on the SAME window ───────────────────
  // There used to be two sets of these: one pinned to yesterday for the
  // "Yesterday's Order Analysis" block and one driven by the picker, saying
  // much the same thing twice (Graeme, 2026-09-18). One window now feeds
  // every tile. An empty period (month-to-date on the 1st) fetches nothing.
  const periodEnabled = !period.empty;

  const {
    data: periodSummary,
    isLoading: periodLoading,
    isFetching: periodFetching,
    error: periodError,
    refetch: refetchPeriod,
    dataUpdatedAt: periodUpdatedAt,
  } = useQuery({
    queryKey: ["founder-period-summary", from, to],
    queryFn: () => fetchSalesSummary(from, to),
    staleTime: 5 * 60 * 1000,
    enabled: periodEnabled,
  });

  const {
    data: orderTypes,
    isLoading: orderTypesLoading,
    isFetching: orderTypesFetching,
    error: orderTypesError,
    refetch: refetchOrderTypes,
    dataUpdatedAt: orderTypesUpdatedAt,
  } = useQuery({
    queryKey: ["founder-orders-by-type", from, to],
    queryFn: () => fetchOrdersByType(from, to),
    staleTime: 5 * 60 * 1000,
    enabled: periodEnabled,
  });

  // Storefront conversion (sessions → orders) via ShopifyQL, over the same
  // period. conversionRate = orderCount / sessions, matching what Shopify
  // Admin's online-store conversion report shows.
  const {
    data: periodConversion,
    isLoading: conversionLoading,
    isFetching: conversionFetching,
    error: conversionError,
    refetch: refetchConversion,
    dataUpdatedAt: conversionUpdatedAt,
  } = useQuery({
    queryKey: ["founder-conversion", from, to],
    queryFn: () => fetchConversion(from, to),
    staleTime: 5 * 60 * 1000,
    enabled: periodEnabled,
  });

  // Ad spend for every day of the period. Days with nothing recorded are
  // absent rather than zero, which is what lets the ROAS tile tell "we spent
  // nothing" from "nobody has told us yet".
  const {
    data: periodSpend,
    isLoading: adSpendLoading,
    isFetching: adSpendFetching,
    refetch: refetchAdSpend,
  } = useQuery({
    queryKey: ["founder-ad-spend-range", from, to],
    queryFn: () => fetchAdSpendRange(from, to),
    staleTime: 5 * 60 * 1000,
    enabled: periodEnabled,
  });

  // ── Ad spend for the period ──────────────────────────────────────────────
  const spendRows = useMemo(() => periodSpend?.days ?? [], [periodSpend]);
  const spendByDate = useMemo(() => {
    const m = new Map<string, (typeof spendRows)[number]>();
    for (const row of spendRows) if (row.amount != null) m.set(row.date, row);
    return m;
  }, [spendRows]);
  const recordedDays = useMemo(
    () => period.days.filter((d) => spendByDate.has(d)).length,
    [period, spendByDate],
  );
  const missingSpendDays = period.dayCount - recordedDays;
  /** Total of the days we actually have. null when we have none, so the tile
   *  shows "Set…" rather than a £0.00 that would read as "we spent nothing". */
  const periodSpendTotal = useMemo(() => {
    if (recordedDays === 0) return null;
    return period.days.reduce((sum, d) => sum + (spendByDate.get(d)?.amount ?? 0), 0);
  }, [period, spendByDate, recordedDays]);

  // Typing a figure only makes sense for one day at a time, so the pencil
  // appears only on a single-day period. Multi-day periods are read-only —
  // pick Yesterday (or a single custom day) to correct a figure.
  const editableDay = period.dayCount === 1 ? period.days[0] : null;
  const editableRow = editableDay ? spendRows.find((r) => r.date === editableDay) ?? null : null;

  const [editingSpend, setEditingSpend] = useState(false);
  const [spendInput, setSpendInput] = useState("");
  const adSpendMutation = useMutation({
    mutationFn: (amount: number | null) => {
      if (!editableDay) throw new Error("Pick a single day to edit its ad spend");
      return saveAdSpend(editableDay, amount);
    },
    onSuccess: () => { setEditingSpend(false); refetchAdSpend(); },
  });

  // Is Meta connected? Until the credentials exist in Railway this stays
  // false and the panel says so — it must never show a £0, which would read
  // as "we spent nothing" rather than "nobody has told us yet".
  const { data: metaStatus, refetch: refetchMetaStatus } = useQuery({
    queryKey: ["meta-ads-status"],
    queryFn: fetchMetaStatus,
    staleTime: 5 * 60 * 1000,
  });
  const metaRefresh = useMutation({
    mutationFn: refreshFromMeta,
    // A sync writes several days at once, so the whole period is stale.
    onSuccess: () => { refetchAdSpend(); refetchMetaStatus(); },
  });
  const lastSync = metaRefresh.data ?? metaStatus?.lastSync ?? null;

  // The one line under the Ad Spend figure. Every branch has to be true
  // without a number to lean on — "not connected" and "sync failed" are
  // real states, and saying nothing would leave a stale figure looking live.
  const metaSpendNote = useMemo((): { text: string; title?: string; warning?: string | null } => {
    if (metaRefresh.isPending) return { text: "Refreshing from Meta…" };
    if (metaRefresh.isError) {
      return { text: "Tap the arrows to try Meta again", warning: "Couldn't reach Meta just now — the figure shown is the last one we had." };
    }
    if (!metaStatus) return { text: "Typed in by hand" };
    if (!metaStatus.connected) {
      return {
        text: "Not connected to Meta yet — typed in by hand",
        title: metaStatus.message ?? undefined,
      };
    }
    const warning = lastSync?.ok === false
      ? "Last sync with Meta failed, so this may be out of date."
      : lastSync?.timezone && !lastSync.timezone.aligned
        ? lastSync.timezone.warning
        : null;

    // One day: say exactly where that day's figure came from.
    if (editableDay) {
      if (editableRow?.source === "manual") {
        return { text: "Typed in by you — Meta won't overwrite it", warning };
      }
      if (editableRow?.source === "meta") {
        const when = editableRow.syncedAt
          ? `${formatDistanceToNow(new Date(editableRow.syncedAt))} ago`
          : "just now";
        return { text: `From Meta, ${when}`, title: lastSync?.message, warning };
      }
      return { text: "No figure from Meta for this day yet", warning };
    }

    // Several days: how much of the period we actually have, and how it got
    // here. A total over four of seven days must never look like a week.
    if (recordedDays === 0) {
      return { text: `No ad spend recorded for these ${period.dayCount} days`, warning };
    }
    const typed = period.days.filter((d) => spendByDate.get(d)?.source === "manual").length;
    const provenance = typed === 0
      ? "all from Meta"
      : typed === recordedDays
        ? "all typed in by you"
        : `${typed} typed in by you`;
    return {
      text: `${recordedDays} of ${period.dayCount} days recorded · ${provenance}`,
      warning: missingSpendDays > 0
        ? `${missingSpendDays} day${missingSpendDays === 1 ? "" : "s"} in this period have no spend figure, so this total is only part of the story.`
        : warning,
    };
  }, [metaRefresh.isPending, metaRefresh.isError, metaStatus, lastSync, editableDay, editableRow, recordedDays, missingSpendDays, period, spendByDate]);

  function submitAdSpend() {
    const trimmed = spendInput.trim();
    if (trimmed === "") { adSpendMutation.mutate(null); return; }
    const n = Number(trimmed.replace(/[£,\s]/g, ""));
    if (Number.isFinite(n) && n >= 0) adSpendMutation.mutate(Math.round(n * 100) / 100);
  }

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
  const tagSummaryFetching = useIsFetching({ queryKey: ["tag-summary"] });
  const customPanelsFetching = useIsFetching({ queryKey: ["founder-custom-panels"] });
  const isAnyFetching = monthFetching || periodFetching || orderTypesFetching || conversionFetching || adSpendFetching || tagSummaryFetching > 0 || customPanelsFetching > 0;
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const latestDataUpdate = useMemo(() => {
    const timestamps = [monthUpdatedAt, periodUpdatedAt, orderTypesUpdatedAt, conversionUpdatedAt].filter(Boolean);
    return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
  }, [monthUpdatedAt, periodUpdatedAt, orderTypesUpdatedAt, conversionUpdatedAt]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      refetchMonth(),
      refetchPeriod(),
      refetchOrderTypes(),
      refetchConversion(),
      refetchAdSpend(),
      queryClient.invalidateQueries({ queryKey: ["tag-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["founder-custom-panels"] }),
    ]);
  }, [refetchMonth, refetchPeriod, refetchOrderTypes, refetchConversion, refetchAdSpend, queryClient]);

  function getGroupCount(tag: string) {
    return orderTypes?.groups.find((g) => g.tag === tag)?.count ?? 0;
  }
  function getGroupOrders(tag: string) {
    return orderTypes?.groups.find((g) => g.tag === tag)?.orders ?? [];
  }

  // ── Period revenue and ROAS ───────────────────────────────────────────────
  // All of it from the one orders-by-type read for the selected period.
  // revenueForTags dedupes by order id, so the combined subscription figure
  // can't double-count an order that carries both subscription tags.
  const newCustomerRevenue = useMemo(
    () => revenueForTags(orderTypes?.groups, [customerType("newCustomer").tag]),
    [orderTypes],
  );
  const subscriptionRevenue = useMemo(
    () => revenueForTags(orderTypes?.groups, SUBSCRIPTION_TAGS),
    [orderTypes],
  );

  const periodRoas = useMemo(
    () => windowRoas({ window: period, revenue: newCustomerRevenue, spendDays: spendRows }),
    [period, newCustomerRevenue, spendRows],
  );
  const roasLoading = orderTypesLoading || adSpendLoading;

  // ── Trend graphs ──────────────────────────────────────────────────────────
  // Graeme, 2026-09-25: a line graph behind each tile "so I can see visually
  // what I've done over that period". One graph open per section. It is a
  // full-width item INSIDE the tiles' grid, placed straight after its own
  // tile, and the grids pack densely: on a phone (one column) the graph
  // opens right under the tile tapped instead of below every tile, and on
  // wider screens the rest of the row backfills so it opens under the
  // tile's row (Graeme, 2026-09-26). At a Glance is today's
  // figures, so only Today's Sales / Today's AOV (by the hour) and This Month
  // to Date (by the day) have one — the two month averages don't.
  type GlanceTrend = "todaySales" | "todayAov" | "monthToDate";
  const [glanceTrend, setGlanceTrend] = useState<GlanceTrend | null>(null);
  const [periodTrend, setPeriodTrend] = useState<TrendMetricId | null>(null);
  const glanceToggle = (id: GlanceTrend): TrendToggle => ({
    open: glanceTrend === id,
    onToggle: () => setGlanceTrend((cur) => (cur === id ? null : id)),
  });
  const periodToggle = (id: TrendMetricId, alsoOpenFor: TrendMetricId[] = []): TrendToggle => ({
    open: periodTrend === id || (periodTrend != null && alsoOpenFor.includes(periodTrend)),
    onToggle: () => setPeriodTrend((cur) => (cur === id || (cur != null && alsoOpenFor.includes(cur)) ? null : id)),
  });
  // Today against the same weekday last week, drawn faintly behind today.
  const lastWeekStr = addDays(todayStr, -7);
  const lastWeekName = `Last ${format(new Date(`${lastWeekStr}T12:00:00`), "EEEE")}`;
  const periodCaption = describePeriod(period) + (period.includesToday ? " · today is still running" : "");
  const periodPanel = (metrics: TrendMetricId[]) =>
    periodTrend && metrics.includes(periodTrend) ? (
      <div className="col-span-full">
        <SalesTrendPanel
          key={`${from}-${to}`}
          metric={periodTrend}
          from={from}
          to={to}
          periodCaption={periodCaption}
          alternatives={periodTrend === "revenue" || periodTrend === "orders"
            ? [{ metric: "revenue", label: "Sales" }, { metric: "orders", label: "Orders" }]
            : undefined}
          onSwitchMetric={setPeriodTrend}
          onClose={() => setPeriodTrend(null)}
        />
      </div>
    ) : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      <FounderNav />
      <PageHeader
        title="Numbers"
        description="Sales KPIs and order breakdown."
        action={
          <div className="flex items-center gap-3">
            {latestDataUpdate && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Last updated {formatDistanceToNow(latestDataUpdate, { addSuffix: true })}
              </span>
            )}
            <button
              onClick={() => { founderRefresh.triggerSpin(); handleRefresh(); }}
              disabled={isAnyFetching}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:pointer-events-none"
            >
              <RefreshCw className={`w-4 h-4 ${isAnyFetching || founderRefresh.spinning ? "animate-spin" : ""}`} />
              {isAnyFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        }
      />

      {/* ── Section 1: Fixed At-a-Glance KPIs (always this month) ──────────── */}
      <section>
        {sectionHeading("At a Glance — " + format(today, "MMMM yyyy"))}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 grid-flow-row-dense">
          <KpiCard
            title="Today's Sales"
            value={monthSummary ? formatGBP(monthSummary.todayRevenue) : "—"}
            sub={monthSummary ? `${monthSummary.todayOrderCount} order${monthSummary.todayOrderCount !== 1 ? "s" : ""} today` : undefined}
            icon={TrendingUp}
            color="text-primary"
            bg="bg-primary/10"
            loading={monthLoading}
            error={!!monthError}
            trend={glanceToggle("todaySales")}
          />
          {glanceTrend === "todaySales" && (
            <div className="col-span-full">
              <SalesTrendPanel
                key={`todaySales-${todayStr}`}
                metric="revenue"
                from={todayStr}
                to={todayStr}
                title="Sales by the hour — today"
                periodCaption={`${format(today, "EEE d MMM")} so far, against ${lastWeekName.charAt(0).toLowerCase()}${lastWeekName.slice(1)} (dashed)`}
                seriesName="Today"
                compare={{ date: lastWeekStr, name: lastWeekName }}
                onClose={() => setGlanceTrend(null)}
              />
            </div>
          )}
          <KpiCard
            title="Month to Date"
            value={monthSummary ? formatGBP(monthSummary.totalRevenue) : "—"}
            sub={monthSummary ? `${monthSummary.orderCount} orders this month` : undefined}
            icon={BarChart2}
            color="text-blue-500"
            bg="bg-blue-500/10"
            loading={monthLoading}
            error={!!monthError}
            trend={glanceToggle("monthToDate")}
          />
          {glanceTrend === "monthToDate" && (
            <div className="col-span-full">
              <SalesTrendPanel
                key={`month-${monthStart}-${todayStr}`}
                metric="revenue"
                from={monthStart}
                to={todayStr}
                title="Daily sales this month"
                periodCaption={`${format(startOfMonth(today), "d MMM")} to today · today is still running`}
                onClose={() => setGlanceTrend(null)}
              />
            </div>
          )}
          {/* Today's AOV sits third, next to the other "today" figures
              (Graeme, 2026-09-25); the two month-average tiles follow. */}
          <KpiCard
            title="Today's AOV"
            value={monthSummary?.todayAov != null ? formatGBP(monthSummary.todayAov) : "—"}
            sub={monthSummary ? aovSub(monthSummary.todayRevenue, monthSummary.todayPaidOrderCount, "No paid orders yet today") : undefined}
            icon={ShoppingBag}
            color="text-emerald-500"
            bg="bg-emerald-500/10"
            loading={monthLoading}
            error={!!monthError}
            trend={glanceToggle("todayAov")}
          />
          {glanceTrend === "todayAov" && (
            <div className="col-span-full">
              <SalesTrendPanel
                key={`todayAov-${todayStr}`}
                metric="aov"
                from={todayStr}
                to={todayStr}
                title="AOV by the hour — today"
                periodCaption={`${format(today, "EEE d MMM")} so far, against ${lastWeekName.charAt(0).toLowerCase()}${lastWeekName.slice(1)} (dashed)`}
                seriesName="Today"
                compare={{ date: lastWeekStr, name: lastWeekName }}
                onClose={() => setGlanceTrend(null)}
              />
            </div>
          )}
          <KpiCard
            title="Average Daily"
            qualifier="Sales this month"
            value={monthSummary ? formatGBP(monthSummary.averageDailyRevenue) : "—"}
            sub={monthSummary ? `Over ${monthSummary.dayCount} day${monthSummary.dayCount !== 1 ? "s" : ""} so far` : undefined}
            icon={Calculator}
            color="text-violet-500"
            bg="bg-violet-500/10"
            loading={monthLoading}
            error={!!monthError}
          />
          <KpiCard
            title="Forecast"
            qualifier="Estimated monthly"
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

      {/* ── Order Analysis — ONE period drives every tile ──────────────────
          This used to be two blocks: a fixed "Yesterday's Order Analysis"
          and a "Period Analysis" below it, saying much the same thing twice
          (Graeme, 2026-09-18). They are now one section on one selector,
          with Yesterday as the default because it is the most recent period
          that has actually finished. */}
      <section>
        {sectionHeading("Order Analysis — " + period.label)}

        {/* Picker row */}
        <div className="glass-panel p-4 rounded-2xl space-y-3 mb-5">
          {/* Presets. Yesterday and Today lead — the precursor to the longer
              ranges — and the rest follow in increasing length. */}
          <div className="flex flex-wrap gap-2">
            {PERIOD_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all border ${
                  periodId === p.id
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
          {/* Exactly which days are being counted, always spelled out. */}
          <p className="text-xs text-muted-foreground">
            {describePeriod(period)}
            {period.includesToday && " · today is still running, so these figures are partial"}
          </p>
        </div>

        {period.empty ? (
          <div className="glass-panel rounded-2xl p-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">No complete days in this period yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Every period except Today is made of finished days, and this one has none so far.
                Pick Today to see the day in progress.
              </p>
            </div>
          </div>
        ) : (
          <>
            {(orderTypesError || conversionError) && (
              <div className="glass-panel rounded-2xl p-5 flex items-center gap-3 text-destructive mb-4">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm">{((orderTypesError ?? conversionError) as Error).message}</p>
              </div>
            )}

            {/* Period totals */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 grid-flow-row-dense">
              <KpiCard
                title={`Total Sales — ${period.label}`}
                value={periodSummary ? formatGBP(periodSummary.totalRevenue) : "—"}
                sub={periodSummary ? `${periodSummary.orderCount} orders` : undefined}
                icon={BarChart2}
                color="text-blue-500"
                bg="bg-blue-500/10"
                loading={periodLoading}
                error={!!periodError}
                trend={periodToggle("revenue", ["orders"])}
              />
              {periodPanel(["revenue", "orders"])}
              <KpiCard
                title={`AOV — ${period.label}`}
                value={periodSummary?.aov != null ? formatGBP(periodSummary.aov) : "—"}
                sub={periodSummary ? aovSub(periodSummary.totalRevenue, periodSummary.paidOrderCount, "No paid orders in this period") : undefined}
                icon={ShoppingBag}
                color="text-emerald-500"
                bg="bg-emerald-500/10"
                loading={periodLoading}
                error={!!periodError}
                trend={periodToggle("aov")}
              />
              {periodPanel(["aov"])}
            </div>
            <div className="mb-6" />

            {/* Row 1 — new customers, and what they cost.
                The count tile is also the drill-down: tap it for the orders. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 grid-flow-row-dense">
              <OrderTypeCard
                type={customerType("newCustomer")}
                count={getGroupCount(customerType("newCustomer").tag)}
                dayCount={period.dayCount}
                isActive={activeTab === customerType("newCustomer").tag && expandedPanel}
                onClick={() => handleTypeClick(customerType("newCustomer").tag)}
                loading={orderTypesLoading}
                trend={periodToggle("newCustomerOrders")}
              />
              {periodPanel(["newCustomerOrders"])}
              <MoneyTile
                title="New Customer Revenue"
                value={newCustomerRevenue}
                icon={TrendingUp}
                color="text-blue-500"
                bg="bg-blue-500/10"
                loading={orderTypesLoading}
                trend={periodToggle("newCustomerRevenue")}
              />
              {periodPanel(["newCustomerRevenue"])}
              <RoasTile
                title="New Customer ROAS"
                result={periodRoas}
                loading={roasLoading}
                trend={periodToggle("roas")}
              />
              {periodPanel(["roas"])}

              {/* Ad Spend — synced from the Meta Marketing API when it's
                  connected, typed in with the pencil when it isn't. A typed
                  figure always wins: it pins the day and no sync overwrites
                  it. Typing is offered only on a single-day period, because
                  spend is stored per day; multi-day periods show the total
                  of the days we have, and say how many that is. It never
                  shows a £0 for "nobody has told us yet". */}
              <div className={`glass-panel p-5 rounded-2xl flex flex-col gap-3 ${periodTrend === "adSpend" ? "ring-2 ring-primary" : ""}`}>
                <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-orange-500/10 text-orange-500 shrink-0">
                  <Megaphone className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-muted-foreground truncate">Ad Spend</p>
                    {metaStatus?.connected && (
                      <button
                        onClick={() => metaRefresh.mutate()}
                        disabled={metaRefresh.isPending}
                        className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-50"
                        title="Refresh from Meta"
                        aria-label="Refresh from Meta"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${metaRefresh.isPending ? "animate-spin" : ""}`} />
                      </button>
                    )}
                  </div>
                  {adSpendLoading ? (
                    <Skeleton className="h-7 w-16 mt-1" />
                  ) : editingSpend && editableDay ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <input
                        autoFocus
                        inputMode="decimal"
                        value={spendInput}
                        onChange={(e) => setSpendInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") submitAdSpend(); if (e.key === "Escape") setEditingSpend(false); }}
                        placeholder="£0.00"
                        className="w-24 px-2 py-1 rounded-lg border border-border bg-background text-lg font-display font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      <button
                        onClick={submitAdSpend}
                        disabled={adSpendMutation.isPending}
                        className="p-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                        aria-label="Save ad spend"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      {editableDay ? (
                        <button
                          onClick={() => { setSpendInput(editableRow?.amount != null ? String(editableRow.amount) : ""); setEditingSpend(true); }}
                          className="group flex items-center gap-2 text-left"
                          title="Enter this day's ad spend"
                        >
                          <span className={`text-2xl font-display font-bold ${periodSpendTotal == null ? "text-muted-foreground" : ""}`}>
                            {periodSpendTotal != null ? formatGBP(periodSpendTotal) : "Set…"}
                          </span>
                          <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-60 group-hover:opacity-100" />
                        </button>
                      ) : (
                        <p className={`text-2xl font-display font-bold ${periodSpendTotal == null ? "text-muted-foreground" : ""}`}>
                          {periodSpendTotal != null ? formatGBP(periodSpendTotal) : "—"}
                        </p>
                      )}
                      {/* One honest line about where this number came from. It
                          never fills in a figure the app doesn't actually have. */}
                      <p className="text-xs text-muted-foreground mt-0.5 truncate" title={metaSpendNote.title}>
                        {metaSpendNote.text}
                      </p>
                      {metaSpendNote.warning && (
                        <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5 flex items-start gap-1">
                          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                          <span>{metaSpendNote.warning}</span>
                        </p>
                      )}
                    </>
                  )}
                </div>
                </div>
                {/* Its own button, not the whole tile: the tile already holds
                    the pencil and the Meta refresh. */}
                <div className="mt-auto pt-1">
                  <TrendChip open={periodTrend === "adSpend"} onClick={periodToggle("adSpend").onToggle} />
                </div>
              </div>
              {periodPanel(["adSpend"])}
            </div>
            <div className="mb-4" />

            {/* Row 2 — subscriptions, and the storefront's own conversion.
                Conversion Rate has no graph: it is Shopify's own session
                metric (ShopifyQL), not something the orders mirror holds. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 grid-flow-row-dense">
              {(["recurringSub", "newSub"] as const).map((id) => (
                <Fragment key={id}>
                <OrderTypeCard
                  type={customerType(id)}
                  count={getGroupCount(customerType(id).tag)}
                  dayCount={period.dayCount}
                  isActive={activeTab === customerType(id).tag && expandedPanel}
                  onClick={() => handleTypeClick(customerType(id).tag)}
                  loading={orderTypesLoading}
                  trend={periodToggle(id === "recurringSub" ? "recurringSubOrders" : "newSubOrders")}
                />
                {periodPanel([id === "recurringSub" ? "recurringSubOrders" : "newSubOrders"])}
                </Fragment>
              ))}
              {/* Recurring and new subscription orders combined, deduped by
                  order id so an order carrying both tags is counted once. */}
              <MoneyTile
                title="Total Subscription Revenue"
                value={subscriptionRevenue}
                sub="Recurring and new combined"
                icon={Repeat}
                color="text-violet-500"
                bg="bg-violet-500/10"
                loading={orderTypesLoading}
                trend={periodToggle("subscriptionRevenue")}
              />
              {periodPanel(["subscriptionRevenue"])}

              {/* Conversion Rate — Shopify's own online-store metric via
                  ShopifyQL. Session-based, so subscription renewals are
                  inherently excluded. */}
              <div className="glass-panel p-5 rounded-2xl flex items-center gap-4">
                <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500 shrink-0">
                  <BarChart2 className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-muted-foreground truncate">Conversion Rate</p>
                  {conversionLoading ? (
                    <Skeleton className="h-7 w-16 mt-1" />
                  ) : periodConversion?.conversionRate != null ? (
                    <>
                      <p className="text-2xl font-display font-bold">{(periodConversion.conversionRate * 100).toFixed(2)}%</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {periodConversion.orderCount != null && periodConversion.sessions != null
                          ? `${periodConversion.orderCount} of ${periodConversion.sessions} sessions · Shopify metric`
                          : "Shopify metric"}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-display font-bold text-muted-foreground">—</p>
                      <p className="text-xs text-muted-foreground mt-0.5">No Shopify session data for this period</p>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Drill-down. Tap any count tile above to open the orders behind
                it; the tab strip then reaches every order type, wholesale
                included — it has no tile of its own but is not lost. */}
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
          </>
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

      {/* ── Section 4: Dispatch Orders ─────────────────────────────────────────
          The Kitchen Dashboard's own panel — same component, same data, so a
          change to it shows on both pages (Graeme, 2026-09-26). */}
      <section>
        <DispatchOrdersPanel />
      </section>
    </div>
  );
}
