import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { ShoppingBag, Package, RefreshCw, AlertCircle, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Scan } from "lucide-react";
import { format, startOfWeek, addWeeks, isSameWeek, parseISO } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface VariantCount {
  title: string;
  quantity: number;
  orderCount: number;
}

interface ShopifyProduct {
  productTitle: string;
  variants: VariantCount[];
  totalQuantity: number;
  orderCount: number;
}

interface ShopifyOrderSummary {
  tag: string;
  orderCount: number;
  products: ShopifyProduct[];
}

interface FilteredProduct {
  productTitle: string;
  variants: VariantCount[];
  totalQuantity: number;
  orderCount: number;
}

async function fetchShopifyOrderSummary(tag: string): Promise<ShopifyOrderSummary> {
  const res = await fetch(`${BASE}/api/shopify/order-summary?tag=${encodeURIComponent(tag)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Failed to fetch Shopify data");
  }
  return res.json();
}

interface WeeklyOrderDay {
  date: string;
  deliveryDate: string;
  day: string;
  orderCount: number;
  fulfilledCount: number;
  unfulfilledCount: number;
}

interface WeeklyOrdersResponse {
  weekStart: string;
  days: WeeklyOrderDay[];
}

async function fetchWeeklyOrders(weekStart: string): Promise<WeeklyOrdersResponse> {
  const res = await fetch(`${BASE}/api/shopify/weekly-orders?weekStart=${encodeURIComponent(weekStart)}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch weekly orders");
  return res.json();
}

function getMonday(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

function formatMonday(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function getDefaultWeekOffset(): number {
  const now = new Date();
  if (now.getDay() === 5 && now.getHours() >= 15) return 1;
  return 0;
}

type SortCol = "product" | "orders" | "qty";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol; sortDir: SortDir }) {
  if (sortCol !== col) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />;
  return sortDir === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />;
}

export default function Dispatches() {
  const [, navigate] = useLocation();
  const today = new Date();
  const currentMonday = getMonday(today);

  const [weekOffset, setWeekOffset] = useState<number>(getDefaultWeekOffset);
  const selectedMonday = addWeeks(currentMonday, weekOffset);
  const weekStartStr = formatMonday(selectedMonday);

  const isCurrentWeek = weekOffset === 0;
  const todayStr = format(today, "yyyy-MM-dd");

  const [dateTag, setDateTag] = useState(format(new Date(), "yyyy-MM-dd"));
  const [queryTag, setQueryTag] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("qty");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [variantFilter, setVariantFilter] = useState("2 Pack");
  const [excludeVariant, setExcludeVariant] = useState("8 Pack Bag");
  const [excludeTitle, setExcludeTitle] = useState("F2F");

  const { data: weeklyData, isLoading: weeklyLoading, refetch: refetchWeekly } = useQuery({
    queryKey: ["shopify-weekly-orders", weekStartStr],
    queryFn: () => fetchWeeklyOrders(weekStartStr),
    staleTime: 5 * 60 * 1000,
  });

  const weeklyOrders = weeklyData?.days;

  const todayIndex = weeklyOrders?.findIndex(d => d.date === todayStr) ?? -1;

  const weekSunday = addWeeks(selectedMonday, 1);
  weekSunday.setDate(weekSunday.getDate() - 1);
  const weekLabel = `${format(selectedMonday, "d MMM")} – ${format(weekSunday, "d MMM yyyy")}`;

  const dayOfWeekIndex = isCurrentWeek ? today.getDay() : -1;
  const daysElapsed = isCurrentWeek ? (dayOfWeekIndex === 0 ? 7 : dayOfWeekIndex) : (weekOffset < 0 ? 7 : 0);
  const progressPct = (daysElapsed / 7) * 100;

  function handleBarClick(entry: WeeklyOrderDay) {
    setDateTag(entry.deliveryDate);
    setQueryTag(entry.deliveryDate);
  }

  const { data: shopifyData, isLoading: shopifyLoading, error: shopifyError, refetch } = useQuery({
    queryKey: ["shopify-order-summary", queryTag],
    queryFn: () => fetchShopifyOrderSummary(queryTag!),
    enabled: !!queryTag,
  });

  const sortedProducts = useMemo((): FilteredProduct[] => {
    if (!shopifyData?.products) return [];
    const includeLower = variantFilter.trim().toLowerCase();
    const exclVariantLower = excludeVariant.trim().toLowerCase();
    const exclTitleLower = excludeTitle.trim().toLowerCase();

    const filtered: FilteredProduct[] = [];

    for (const p of shopifyData.products) {
      if (exclTitleLower && p.productTitle.toLowerCase().includes(exclTitleLower)) continue;

      const validVariants = p.variants.filter(v => v && typeof v.title === "string");

      const remainingVariants = exclVariantLower
        ? validVariants.filter(v => !v.title.toLowerCase().includes(exclVariantLower))
        : validVariants;

      if (remainingVariants.length === 0 && validVariants.length > 0) continue;

      if (includeLower && !remainingVariants.some(v => v.title.toLowerCase().includes(includeLower))) continue;

      const totalQuantity = remainingVariants.reduce((s, v) => s + v.quantity, 0);
      const orderCount = remainingVariants.reduce((s, v) => s + v.orderCount, 0);

      filtered.push({ productTitle: p.productTitle, variants: remainingVariants, totalQuantity, orderCount });
    }

    return filtered.sort((a, b) => {
      let cmp = 0;
      if (sortCol === "product") cmp = a.productTitle.localeCompare(b.productTitle);
      else if (sortCol === "orders") cmp = a.orderCount - b.orderCount;
      else if (sortCol === "qty") cmp = a.totalQuantity - b.totalQuantity;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [shopifyData, sortCol, sortDir, variantFilter, excludeVariant, excludeTitle]);

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  }

  const totalOrders = weeklyOrders?.reduce((s, d) => s + d.orderCount, 0) ?? 0;
  const totalFulfilled = weeklyOrders?.reduce((s, d) => s + d.fulfilledCount, 0) ?? 0;
  const totalUnfulfilled = weeklyOrders?.reduce((s, d) => s + d.unfulfilledCount, 0) ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispatch Schedule"
        description="Manage wholesale orders and outgoing deliveries."
      />

      <div className="glass-panel p-6 rounded-2xl border border-border">
        <div className="flex items-center justify-between mb-1">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h3 className="font-display font-bold text-lg">Dispatch Schedule</h3>
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
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => setWeekOffset(o => o - 1)}
                className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                title="Previous week"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium min-w-[180px] text-center">{weekLabel}</span>
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
                  Back to this week
                </button>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" /> Fulfilled</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "hsl(var(--primary) / 0.3)" }} /> Unfulfilled</span>
            </div>
          </div>
          <button
            onClick={() => refetchWeekly()}
            disabled={weeklyLoading}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${weeklyLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {isCurrentWeek && weeklyOrders && (
          <div className="mt-3 mb-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Week progress</span>
              <span>{daysElapsed}/7 days</span>
            </div>
            <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        <div className="h-[200px] w-full mt-4">
          {weeklyLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Fetching orders…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyOrders} barSize={32} onClick={(e) => {
                if (e?.activePayload?.[0]?.payload) handleBarClick(e.activePayload[0].payload);
              }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--secondary))", cursor: "pointer" }}
                  content={({ active, payload }) => {
                    if (active && payload?.length) {
                      const item = payload[0].payload as WeeklyOrderDay;
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
                          <p className="text-xs text-muted-foreground pt-1">Click to view breakdown</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="fulfilledCount" stackId="orders" fill="hsl(142 71% 45%)" radius={[0, 0, 0, 0]} style={{ cursor: "pointer" }} />
                <Bar dataKey="unfulfilledCount" stackId="orders" radius={[6, 6, 0, 0]} style={{ cursor: "pointer" }}>
                  {weeklyOrders?.map((entry, i) => (
                    <Cell
                      key={entry.date}
                      fill={entry.date === todayStr ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.3)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {weeklyOrders && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-border text-sm text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">
                {totalOrders}
              </span>{" "}total orders {isCurrentWeek ? "this week" : ""}
            </span>
            <span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {totalFulfilled}
              </span>{" "}fulfilled
            </span>
            <span>
              <span className="font-semibold text-foreground">
                {totalUnfulfilled}
              </span>{" "}unfulfilled
            </span>
            {todayIndex >= 0 && (
              <span>
                <span className="font-semibold text-primary">
                  {weeklyOrders[todayIndex].orderCount}
                </span>{" "}today ({weeklyOrders[todayIndex].fulfilledCount} done)
              </span>
            )}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className="glass-panel p-6 rounded-2xl border border-border">
          <h3 className="font-display font-semibold text-lg mb-1">Look up orders by date tag</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Enter a date to count how many of each product appear in Shopify orders tagged with that date.
          </p>
          <div className="space-y-3">
            <div className="flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-[200px] max-w-xs">
                <label className="text-sm font-medium mb-1 block">Delivery date</label>
                <input
                  type="date"
                  value={dateTag}
                  onChange={(e) => setDateTag(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Searches orders tagged: <span className="font-mono font-medium text-foreground">{dateTag}</span>
                </p>
              </div>
              <button
                onClick={() => setQueryTag(dateTag)}
                disabled={shopifyLoading}
                className="px-5 py-2 bg-primary text-primary-foreground rounded-xl font-medium flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {shopifyLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
                Fetch Orders
              </button>
            </div>

            <div className="flex gap-3 items-end flex-wrap pt-1 border-t border-border/50">
              <FilterInput
                label="Include variant"
                value={variantFilter}
                onChange={setVariantFilter}
                placeholder="e.g. 2 Pack"
                hint={variantFilter ? `Showing only "${variantFilter}" variants` : "Showing all variants"}
              />
              <FilterInput
                label="Exclude variant"
                value={excludeVariant}
                onChange={setExcludeVariant}
                placeholder="e.g. 8 Pack Bag"
                hint={excludeVariant ? `Hiding "${excludeVariant}" variants` : "No variant exclusion"}
                isExclusion
              />
              <FilterInput
                label="Exclude product title"
                value={excludeTitle}
                onChange={setExcludeTitle}
                placeholder="e.g. F2F"
                hint={excludeTitle ? `Hiding titles containing "${excludeTitle}"` : "No title exclusion"}
                isExclusion
              />
            </div>
          </div>
        </div>

        {shopifyError && (
          <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-medium">Could not fetch Shopify data</p>
              <p className="text-sm opacity-80">{(shopifyError as Error).message}</p>
            </div>
          </div>
        )}

        {shopifyData && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-xl">
                  Orders tagged <span className="text-primary">{shopifyData.tag}</span>
                </h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {shopifyData.orderCount} order{shopifyData.orderCount !== 1 ? "s" : ""} &middot;{" "}
                  {sortedProducts.length} of {shopifyData.products.length} product{shopifyData.products.length !== 1 ? "s" : ""}
                  {variantFilter ? ` · include "${variantFilter}"` : ""}
                  {excludeVariant ? ` · exclude variant "${excludeVariant}"` : ""}
                  {excludeTitle ? ` · exclude title "${excludeTitle}"` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/fulfilment?tag=${encodeURIComponent(shopifyData.tag)}`)}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 transition-opacity"
                >
                  <Scan className="w-4 h-4" />
                  Start Packing
                </button>
                <button
                  onClick={() => refetch()}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RefreshCw className="w-4 h-4" /> Refresh
                </button>
              </div>
            </div>

            {shopifyData.products.length === 0 ? (
              <div className="glass-panel p-10 rounded-2xl border border-border text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>No products found in orders with this tag.</p>
              </div>
            ) : (
              <div className="glass-panel rounded-2xl border border-border overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-secondary/40">
                      <th className="text-left px-5 py-3.5">
                        <button onClick={() => toggleSort("product")} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                          Product <SortIcon col="product" sortCol={sortCol} sortDir={sortDir} />
                        </button>
                      </th>
                      <th className="text-left px-5 py-3.5 text-sm font-medium text-muted-foreground">Variants</th>
                      <th className="text-right px-5 py-3.5">
                        <button onClick={() => toggleSort("orders")} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors ml-auto">
                          Orders <SortIcon col="orders" sortCol={sortCol} sortDir={sortDir} />
                        </button>
                      </th>
                      <th className="text-right px-5 py-3.5">
                        <button onClick={() => toggleSort("qty")} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors ml-auto">
                          Total Qty <SortIcon col="qty" sortCol={sortCol} sortDir={sortDir} />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProducts.map((p, i) => (
                      <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                        <td className="px-5 py-3.5 font-medium">{p.productTitle}</td>
                        <td className="px-5 py-3.5 text-muted-foreground text-sm">
                          {p.variants.length === 0 ? "—" : p.variants.length === 1
                            ? p.variants[0].title
                            : p.variants.map(v => `${v.title} (${v.quantity})`).join(", ")
                          }
                        </td>
                        <td className="px-5 py-3.5 text-right text-muted-foreground">{p.orderCount}</td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="font-bold text-lg bg-secondary px-3 py-1 rounded-lg">{p.totalQuantity}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-secondary/40">
                      <td colSpan={3} className="px-5 py-3.5 text-sm font-medium text-muted-foreground">
                        Total units{variantFilter ? ` (filtered)` : ""}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="font-bold text-lg">
                          {sortedProducts.reduce((s, p) => s + p.totalQuantity, 0)}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterInput({
  label, value, onChange, placeholder, hint, isExclusion = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; isExclusion?: boolean;
}) {
  return (
    <div className="flex-1 min-w-[180px] max-w-xs">
      <label className="text-sm font-medium mb-1 flex items-center gap-1.5 block">
        {isExclusion && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">exclude</span>
        )}
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full px-3 py-2 bg-background border rounded-lg focus-ring pr-8 ${
            isExclusion ? "border-destructive/40 focus:border-destructive/60" : "border-border"
          }`}
        />
        {value && (
          <button
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            title="Clear"
          >
            ×
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
