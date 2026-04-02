import { useState, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Redirect, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useRefreshSpin } from "@/hooks/use-refresh-spin";
import { format, startOfMonth, subDays, subMonths, endOfMonth } from "date-fns";
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  RefreshCw,
  Package,
  DollarSign,
  ShoppingCart,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  ArrowLeft,
  Settings,
  Percent,
  CreditCard,
  Truck,
  Building2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

// ── Types ───────────────────────────────────────────────────────────────────

interface PnlSummary {
  from: string;
  to: string;
  dayCount: number;
  orderCount: number;
  revenue: { gross: number; refunds: number; net: number };
  cogs: {
    total: number;
    ingredientCost: number;
    packagingCost: number;
    labourCost: number;
    unmappedItemCount: number;
    unmappedRevenue: number;
  };
  grossProfit: number;
  grossMarginPercent: number;
  transactionFees: number;
  packagingAndPostage: {
    total: number;
    smallBoxCount: number;
    largeBoxCount: number;
    noShipCount: number;
    smallBoxCost: number;
    largeBoxCost: number;
  };
  overheads: { total: number; dailyRate: number };
  contributionProfit: number;
  contributionMarginPercent: number;
  netProfit: number;
  netMarginPercent: number;
}

interface RecipeBreakdown {
  from: string;
  to: string;
  recipes: Array<{
    recipeId: number;
    recipeName: string;
    unitsSold: number;
    unitCost: number;
    totalCost: number;
    revenue: number;
    marginPercent: number | null;
  }>;
  unmappedItemCount: number;
  unmappedRevenue: number;
}

interface Overhead {
  id: number;
  name: string;
  monthlyAmount: number;
}

// ── Fetch helpers ───────────────────────────────────────────────────────────

async function fetchPnlSummary(from: string, to: string): Promise<PnlSummary> {
  const res = await fetch(`${BASE}/api/pnl/summary?from=${from}&to=${to}`, { credentials: "include" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

async function fetchBreakdown(from: string, to: string): Promise<RecipeBreakdown> {
  const res = await fetch(`${BASE}/api/pnl/breakdown?from=${from}&to=${to}`, { credentials: "include" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

async function fetchSettings(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/pnl/settings`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json();
}

async function fetchOverheads(): Promise<Overhead[]> {
  const res = await fetch(`${BASE}/api/pnl/overheads`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load overheads");
  return res.json();
}

// ── Formatters ──────────────────────────────────────────────────────────────

function formatGBP(amount: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

// ── Date presets ────────────────────────────────────────────────────────────

function buildPresets() {
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");
  return [
    { label: "Today", from: todayStr, to: todayStr },
    { label: "Last 7 days", from: format(subDays(today, 6), "yyyy-MM-dd"), to: todayStr },
    { label: "Month to date", from: format(startOfMonth(today), "yyyy-MM-dd"), to: todayStr },
    { label: "Last month", from: format(startOfMonth(subMonths(today, 1)), "yyyy-MM-dd"), to: format(endOfMonth(subMonths(today, 1)), "yyyy-MM-dd") },
    { label: "Last 6 months", from: format(subMonths(today, 6), "yyyy-MM-dd"), to: todayStr },
  ] as const;
}

// ── Main component ──────────────────────────────────────────────────────────

export default function FounderPnL() {
  const { state } = useAuth();
  if (state.status === "loading") return null;
  if (state.status !== "authenticated" || state.user.email !== FOUNDER_EMAIL) {
    return <Redirect to="/" />;
  }
  return <PnLDashboard />;
}

function PnLDashboard() {
  const queryClient = useQueryClient();
  const refreshSpin = useRefreshSpin();
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(todayStr);
  const [activePreset, setActivePreset] = useState("Month to date");
  const [showSettings, setShowSettings] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [sortField, setSortField] = useState<"revenue" | "totalCost" | "marginPercent" | "unitsSold">("revenue");
  const [sortAsc, setSortAsc] = useState(false);

  const presets = useMemo(() => buildPresets(), [todayStr]);

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

  // ── Queries ─────────────────────────────────────────────────────────────

  const { data: summary, isLoading: summaryLoading, isFetching: summaryFetching, error: summaryError, refetch: refetchSummary } = useQuery({
    queryKey: ["pnl-summary", from, to],
    queryFn: () => fetchPnlSummary(from, to),
    staleTime: 5 * 60 * 1000,
  });

  const { data: breakdown, isLoading: breakdownLoading, refetch: refetchBreakdown } = useQuery({
    queryKey: ["pnl-breakdown", from, to],
    queryFn: () => fetchBreakdown(from, to),
    staleTime: 5 * 60 * 1000,
  });

  const { data: settings } = useQuery({
    queryKey: ["pnl-settings"],
    queryFn: fetchSettings,
  });

  const { data: overheads = [], refetch: refetchOverheads } = useQuery({
    queryKey: ["pnl-overheads"],
    queryFn: fetchOverheads,
  });

  const isAnyFetching = summaryFetching;

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchSummary(), refetchBreakdown(), refetchOverheads()]);
  }, [refetchSummary, refetchBreakdown, refetchOverheads]);

  // ── Settings mutations ──────────────────────────────────────────────────

  const updateSetting = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const res = await fetch(`${BASE}/api/pnl/settings/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("Failed to save setting");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pnl-settings"] });
      queryClient.invalidateQueries({ queryKey: ["pnl-summary"] });
    },
  });

  // ── Overhead mutations ──────────────────────────────────────────────────

  const addOverhead = useMutation({
    mutationFn: async ({ name, monthlyAmount }: { name: string; monthlyAmount: number }) => {
      const res = await fetch(`${BASE}/api/pnl/overheads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, monthlyAmount }),
      });
      if (!res.ok) throw new Error("Failed to add overhead");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pnl-overheads"] });
      queryClient.invalidateQueries({ queryKey: ["pnl-summary"] });
    },
  });

  const deleteOverhead = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/pnl/overheads/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete overhead");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pnl-overheads"] });
      queryClient.invalidateQueries({ queryKey: ["pnl-summary"] });
    },
  });

  const updateOverhead = useMutation({
    mutationFn: async ({ id, name, monthlyAmount }: { id: number; name: string; monthlyAmount: number }) => {
      const res = await fetch(`${BASE}/api/pnl/overheads/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, monthlyAmount }),
      });
      if (!res.ok) throw new Error("Failed to update overhead");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pnl-overheads"] });
      queryClient.invalidateQueries({ queryKey: ["pnl-summary"] });
    },
  });

  // ── Waterfall chart data ────────────────────────────────────────────────

  const waterfallData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: "Revenue", value: summary.revenue.net, fill: "#22c55e" },
      { name: "COGS", value: -summary.cogs.total, fill: "#ef4444" },
      { name: "Gross Profit", value: summary.grossProfit, fill: summary.grossProfit >= 0 ? "#3b82f6" : "#ef4444" },
      { name: "Fees", value: -summary.transactionFees, fill: "#f97316" },
      { name: "P&P", value: -summary.packagingAndPostage.total, fill: "#f97316" },
      { name: "Overheads", value: -summary.overheads.total, fill: "#a855f7" },
      { name: "Net Profit", value: summary.netProfit, fill: summary.netProfit >= 0 ? "#22c55e" : "#ef4444" },
    ];
  }, [summary]);

  // ── Sorted breakdown ────────────────────────────────────────────────────

  const sortedRecipes = useMemo(() => {
    if (!breakdown?.recipes) return [];
    return [...breakdown.recipes].sort((a, b) => {
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      return sortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [breakdown, sortField, sortAsc]);

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="P&L Dashboard"
        description="Estimated profit & loss from Shopify data"
        action={
          <div className="flex items-center gap-3">
            <Link href="/founder" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" /> Founder View
            </Link>
            <button
              onClick={() => { refreshSpin.triggerSpin(); handleRefresh(); }}
              disabled={isAnyFetching}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${isAnyFetching || refreshSpin.spinning ? "animate-spin" : ""}`} />
              {isAnyFetching ? "Loading…" : "Refresh"}
            </button>
          </div>
        }
      />

      {/* ── Date Picker ──────────────────────────────────────────────────── */}
      <div className="glass-panel p-4 rounded-2xl space-y-3">
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
        </div>
      </div>

      {/* ── Error state ──────────────────────────────────────────────────── */}
      {summaryError && (
        <div className="glass-panel p-4 rounded-2xl border-destructive/30 bg-destructive/5">
          <p className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {summaryError instanceof Error ? summaryError.message : "Failed to load P&L data"}
          </p>
        </div>
      )}

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Net Revenue"
          value={summary ? formatGBP(summary.revenue.net) : "—"}
          sub={summary ? `${summary.orderCount} orders | Refunds: ${formatGBP(summary.revenue.refunds)}` : undefined}
          icon={DollarSign}
          color="text-emerald-500"
          bg="bg-emerald-500/10"
          loading={summaryLoading}
        />
        <KpiCard
          title="Cost of Goods"
          value={summary ? formatGBP(summary.cogs.total) : "—"}
          sub={summary ? `Ingredients: ${formatGBP(summary.cogs.ingredientCost)} | Pkg: ${formatGBP(summary.cogs.packagingCost)} | Labour: ${formatGBP(summary.cogs.labourCost)}` : undefined}
          icon={ShoppingCart}
          color="text-red-500"
          bg="bg-red-500/10"
          loading={summaryLoading}
        />
        <KpiCard
          title="Gross Profit"
          value={summary ? formatGBP(summary.grossProfit) : "—"}
          sub={summary ? `Margin: ${formatPct(summary.grossMarginPercent)}` : undefined}
          icon={summary && summary.grossProfit >= 0 ? TrendingUp : TrendingDown}
          color={summary && summary.grossProfit >= 0 ? "text-blue-500" : "text-red-500"}
          bg={summary && summary.grossProfit >= 0 ? "bg-blue-500/10" : "bg-red-500/10"}
          loading={summaryLoading}
        />
        <KpiCard
          title="Net Profit"
          value={summary ? formatGBP(summary.netProfit) : "—"}
          sub={summary ? `Margin: ${formatPct(summary.netMarginPercent)} | ${summary.dayCount} days` : undefined}
          icon={summary && summary.netProfit >= 0 ? TrendingUp : TrendingDown}
          color={summary && summary.netProfit >= 0 ? "text-emerald-500" : "text-red-500"}
          bg={summary && summary.netProfit >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"}
          loading={summaryLoading}
        />
      </div>

      {/* ── Unmapped Items Warning ───────────────────────────────────────── */}
      {summary && summary.cogs.unmappedItemCount > 0 && (
        <div className="glass-panel p-4 rounded-2xl border-amber-500/30 bg-amber-500/5">
          <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              <strong>{summary.cogs.unmappedItemCount}</strong> line items ({formatGBP(summary.cogs.unmappedRevenue)} revenue) could not be mapped to recipes — their COGS is not included.
              Map these products in the recipe Shopify mapping settings.
            </span>
          </p>
        </div>
      )}

      {/* ── P&L Waterfall Chart ──────────────────────────────────────────── */}
      {summary && (
        <div className="glass-panel p-6 rounded-2xl">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">P&L Waterfall</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterfallData} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => `£${Math.abs(v / 1000).toFixed(1)}k`} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [formatGBP(Math.abs(value)), value < 0 ? "Cost" : "Profit"]}
                  contentStyle={{ fontSize: 13, borderRadius: 12 }}
                />
                <ReferenceLine y={0} stroke="#71717a" strokeDasharray="3 3" />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {waterfallData.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Expense Detail Cards ─────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="glass-panel p-5 rounded-2xl">
            <div className="flex items-center gap-2 mb-3">
              <CreditCard className="w-4 h-4 text-orange-500" />
              <h3 className="text-sm font-medium">Transaction Fees</h3>
            </div>
            <p className="text-2xl font-bold">{formatGBP(summary.transactionFees)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Avg {formatGBP(summary.orderCount > 0 ? summary.transactionFees / summary.orderCount : 0)}/order
            </p>
          </div>
          <div className="glass-panel p-5 rounded-2xl">
            <div className="flex items-center gap-2 mb-3">
              <Truck className="w-4 h-4 text-orange-500" />
              <h3 className="text-sm font-medium">Packaging & Postage</h3>
            </div>
            <p className="text-2xl font-bold">{formatGBP(summary.packagingAndPostage.total)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.packagingAndPostage.smallBoxCount} small ({formatGBP(summary.packagingAndPostage.smallBoxCost)}/ea)
              {" · "}
              {summary.packagingAndPostage.largeBoxCount} large ({formatGBP(summary.packagingAndPostage.largeBoxCost)}/ea)
              {summary.packagingAndPostage.noShipCount > 0 && ` · ${summary.packagingAndPostage.noShipCount} digital (no ship)`}
            </p>
          </div>
          <div className="glass-panel p-5 rounded-2xl">
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="w-4 h-4 text-violet-500" />
              <h3 className="text-sm font-medium">Overheads</h3>
            </div>
            <p className="text-2xl font-bold">{formatGBP(summary.overheads.total)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {formatGBP(summary.overheads.dailyRate)}/day &times; {summary.dayCount} days
            </p>
          </div>
        </div>
      )}

      {/* ── Per-Recipe Breakdown ──────────────────────────────────────────── */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <button
          onClick={() => setShowBreakdown(!showBreakdown)}
          className="w-full flex items-center justify-between p-5 hover:bg-secondary/50 transition-colors"
        >
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Product Breakdown</h2>
          {showBreakdown ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showBreakdown && (
          <div className="overflow-x-auto">
            {breakdownLoading ? (
              <div className="p-5 space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : sortedRecipes.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No recipe data for this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-t border-border bg-secondary/30">
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground">Recipe</th>
                    <SortHeader label="Units" field="unitsSold" current={sortField} asc={sortAsc} onToggle={toggleSort} />
                    <SortHeader label="Unit Cost" field="totalCost" current={sortField} asc={sortAsc} onToggle={toggleSort} />
                    <SortHeader label="Total Cost" field="totalCost" current={sortField} asc={sortAsc} onToggle={toggleSort} />
                    <SortHeader label="Revenue" field="revenue" current={sortField} asc={sortAsc} onToggle={toggleSort} />
                    <SortHeader label="Margin" field="marginPercent" current={sortField} asc={sortAsc} onToggle={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedRecipes.map((r) => (
                    <tr key={r.recipeId} className="border-t border-border hover:bg-secondary/20 transition-colors">
                      <td className="px-5 py-3 font-medium">{r.recipeName}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{r.unitsSold}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatGBP(r.unitCost)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatGBP(r.totalCost)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatGBP(r.revenue)}</td>
                      <td className="px-5 py-3 text-right">
                        {r.marginPercent != null ? (
                          <MarginBadge value={r.marginPercent} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ── Settings Panel ────────────────────────────────────────────────── */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="w-full flex items-center justify-between p-5 hover:bg-secondary/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">P&L Settings</h2>
          </div>
          {showSettings ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showSettings && (
          <div className="p-5 space-y-6 border-t border-border">
            {/* P&P Cost Settings */}
            <div>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Package className="w-4 h-4" /> Packaging & Postage Costs
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SettingInput
                  label="Small Box Cost (£)"
                  value={settings?.small_box_cost ?? "2.50"}
                  onSave={(v) => updateSetting.mutate({ key: "small_box_cost", value: v })}
                />
                <SettingInput
                  label="Large Box Cost (£)"
                  value={settings?.large_box_cost ?? "3.50"}
                  onSave={(v) => updateSetting.mutate({ key: "large_box_cost", value: v })}
                />
              </div>
            </div>

            {/* Overheads */}
            <div>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Building2 className="w-4 h-4" /> Monthly Overheads
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Enter monthly cost for each overhead. Daily rate is calculated as (monthly &times; 12) / 365.
              </p>
              <div className="space-y-2">
                {overheads.map((oh) => (
                  <OverheadRow
                    key={oh.id}
                    overhead={oh}
                    onUpdate={(name, amount) => updateOverhead.mutate({ id: oh.id, name, monthlyAmount: amount })}
                    onDelete={() => deleteOverhead.mutate(oh.id)}
                  />
                ))}
                <AddOverheadRow onAdd={(name, amount) => addOverhead.mutate({ name, monthlyAmount: amount })} />
              </div>
              {overheads.length > 0 && (
                <p className="text-xs text-muted-foreground mt-3">
                  Total monthly: {formatGBP(overheads.reduce((s, o) => s + o.monthlyAmount, 0))}
                  {" · "}
                  Daily rate: {formatGBP((overheads.reduce((s, o) => s + o.monthlyAmount, 0) * 12) / 365)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ title, value, sub, icon: Icon, color, bg, loading }: {
  title: string; value: string; sub?: string; icon: React.ElementType; color: string; bg: string; loading?: boolean;
}) {
  return (
    <div className="glass-panel p-5 rounded-2xl flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className={`p-2.5 rounded-xl ${bg} ${color}`}><Icon className="w-4 h-4" /></div>
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-32" />
      ) : (
        <>
          <p className="text-2xl font-display font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </>
      )}
    </div>
  );
}

function MarginBadge({ value }: { value: number }) {
  const color = value >= 50 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : value >= 30 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
    : "bg-red-500/10 text-red-600 dark:text-red-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {value.toFixed(1)}%
    </span>
  );
}

function SortHeader({ label, field, current, asc, onToggle }: {
  label: string; field: string; current: string; asc: boolean;
  onToggle: (field: "revenue" | "totalCost" | "marginPercent" | "unitsSold") => void;
}) {
  const active = current === field;
  return (
    <th
      className="text-right px-5 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
      onClick={() => onToggle(field as "revenue" | "totalCost" | "marginPercent" | "unitsSold")}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (asc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  );
}

function SettingInput({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function handleSave() {
    onSave(draft);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div
        className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 cursor-pointer hover:bg-secondary transition-colors"
        onClick={() => { setDraft(value); setEditing(true); }}
      >
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium tabular-nums">£{value}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/50">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <input
        type="number"
        step="0.01"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
        autoFocus
        className="w-24 text-sm text-right bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary tabular-nums"
      />
      <button onClick={handleSave} className="text-xs font-medium text-primary hover:underline">Save</button>
    </div>
  );
}

function OverheadRow({ overhead, onUpdate, onDelete }: {
  overhead: Overhead;
  onUpdate: (name: string, amount: number) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(overhead.name);
  const [amount, setAmount] = useState(String(overhead.monthlyAmount));

  function handleSave() {
    onUpdate(name, parseFloat(amount) || 0);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 group">
        <span
          className="text-sm cursor-pointer hover:text-primary transition-colors"
          onClick={() => setEditing(true)}
        >
          {overhead.name}
        </span>
        <div className="flex items-center gap-3">
          <span
            className="text-sm font-medium tabular-nums cursor-pointer hover:text-primary transition-colors"
            onClick={() => setEditing(true)}
          >
            {formatGBP(overhead.monthlyAmount)}/mo
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            ({formatGBP((overhead.monthlyAmount * 12) / 365)}/day)
          </span>
          <button
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/30">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        autoFocus
        className="flex-1 text-sm bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <input
        type="number"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
        className="w-28 text-sm text-right bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary tabular-nums"
      />
      <button onClick={handleSave} className="text-xs font-medium text-primary hover:underline">Save</button>
      <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
    </div>
  );
}

function AddOverheadRow({ onAdd }: { onAdd: (name: string, amount: number) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  function handleAdd() {
    if (!name.trim() || !amount) return;
    onAdd(name.trim(), parseFloat(amount) || 0);
    setName("");
    setAmount("");
    setAdding(false);
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2"
      >
        <Plus className="w-3.5 h-3.5" /> Add overhead
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/30">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Rent"
        autoFocus
        className="flex-1 text-sm bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <input
        type="number"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        placeholder="Monthly £"
        className="w-28 text-sm text-right bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary tabular-nums"
      />
      <button onClick={handleAdd} disabled={!name.trim() || !amount} className="text-xs font-medium text-primary hover:underline disabled:opacity-40">Add</button>
      <button onClick={() => setAdding(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
    </div>
  );
}
