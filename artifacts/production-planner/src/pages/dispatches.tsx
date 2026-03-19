import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListDispatchOrders, useListRecipes } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { Truck, Plus, Trash2, CheckCircle2, ShoppingBag, Package, RefreshCw, AlertCircle, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, isPast, isToday } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

const schema = z.object({
  recipeId: z.coerce.number().min(1),
  dispatchDate: z.string(),
  quantity: z.coerce.number().min(1),
  customer: z.string().min(1),
  status: z.enum(['pending', 'dispatched', 'cancelled'])
});

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
}

async function fetchWeeklyOrders(): Promise<WeeklyOrderDay[]> {
  const res = await fetch(`${BASE}/api/shopify/weekly-orders`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch weekly orders");
  return res.json();
}

type Tab = "schedule" | "shopify";
type SortCol = "product" | "orders" | "qty";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol; sortDir: SortDir }) {
  if (sortCol !== col) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />;
  return sortDir === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />;
}

export default function Dispatches() {
  const { data: dispatches, isLoading } = useListDispatchOrders();
  const { data: recipes } = useListRecipes();
  const { createDispatch, updateDispatch, deleteDispatch } = useAppMutations();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("schedule");
  const [dateTag, setDateTag] = useState(format(new Date(), "yyyy-MM-dd"));
  const [queryTag, setQueryTag] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("qty");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [variantFilter, setVariantFilter] = useState("2 Pack");
  const [excludeVariant, setExcludeVariant] = useState("8 Pack Bag");
  const [excludeTitle, setExcludeTitle] = useState("F2F");

  const { data: weeklyOrders, isLoading: weeklyLoading, refetch: refetchWeekly } = useQuery({
    queryKey: ["shopify-weekly-orders"],
    queryFn: fetchWeeklyOrders,
    staleTime: 5 * 60 * 1000,
  });

  const todayTag = format(new Date(), "yyyy-MM-dd");
  const todayIndex = weeklyOrders?.findIndex(d => d.date === todayTag) ?? -1;

  function handleBarClick(entry: WeeklyOrderDay) {
    setDateTag(entry.deliveryDate);
    setQueryTag(entry.deliveryDate);
    setTab("shopify");
  }

  const { register, handleSubmit, reset } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { dispatchDate: format(new Date(), 'yyyy-MM-dd'), quantity: 10, status: 'pending' as const, customer: "" }
  });

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
      // 1. Title exclusion — drop whole product
      if (exclTitleLower && p.productTitle.toLowerCase().includes(exclTitleLower)) continue;

      // 2. Normalise variants — guard against stale cache returning old string[] format
      const validVariants = p.variants.filter(v => v && typeof v.title === "string");

      // 3. Strip excluded variants, keep the rest
      const remainingVariants = exclVariantLower
        ? validVariants.filter(v => !v.title.toLowerCase().includes(exclVariantLower))
        : validVariants;

      // 4. Drop product entirely if no variants survive the exclusion
      if (remainingVariants.length === 0 && validVariants.length > 0) continue;

      // 5. Apply include filter — keep only products where a remaining variant matches
      if (includeLower && !remainingVariants.some(v => v.title.toLowerCase().includes(includeLower))) continue;

      // 6. Recompute totals from the surviving variants
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

  const onSubmit = (data: z.infer<typeof schema>) => {
    createDispatch.mutate({ data: { ...data, dispatchDate: new Date(data.dispatchDate).toISOString() } }, {
      onSuccess: () => { setIsDialogOpen(false); reset(); }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispatch Schedule"
        description="Manage wholesale orders and outgoing deliveries."
        action={
          tab === "schedule" ? (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <button className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium shadow-md shadow-blue-500/20 hover-lift flex items-center gap-2">
                  <Plus className="w-5 h-5" /> Schedule Delivery
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px] bg-card border-border rounded-2xl">
                <DialogHeader>
                  <DialogTitle className="font-display text-xl">New Dispatch Order</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Customer / Destination</label>
                    <input {...register("customer")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" placeholder="Cafe Name" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Product</label>
                    <select {...register("recipeId")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none">
                      <option value={0} disabled>Select product...</option>
                      {recipes?.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-1 block">Dispatch Date</label>
                      <input type="date" {...register("dispatchDate")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Quantity</label>
                      <input type="number" {...register("quantity")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
                    </div>
                  </div>
                  <button type="submit" disabled={createDispatch.isPending} className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold mt-2 hover:bg-blue-700">
                    Schedule Order
                  </button>
                </form>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      {/* Weekly dispatch chart */}
      <div className="glass-panel p-6 rounded-2xl border border-border">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="font-display font-bold text-lg">Dispatch Schedule — Next 7 Days</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Shopify orders by dispatch date · click a bar to view order details
            </p>
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
                  content={({ active, payload, label }) => {
                    if (active && payload?.length) {
                      const item = payload[0].payload as WeeklyOrderDay;
                      return (
                        <div className="bg-card border border-border rounded-xl px-4 py-3 shadow-lg text-sm space-y-1">
                          <p className="font-semibold">Dispatch: {item.date}</p>
                          <p className="text-muted-foreground text-xs">Delivery: {item.deliveryDate}</p>
                          <p className="text-primary font-bold pt-1">{item.orderCount} orders</p>
                          <p className="text-xs text-muted-foreground">Click to view breakdown</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="orderCount" radius={[6, 6, 0, 0]} style={{ cursor: "pointer" }}>
                  {weeklyOrders?.map((entry, i) => (
                    <Cell
                      key={entry.date}
                      fill={i === todayIndex ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.4)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {weeklyOrders && (
          <div className="flex gap-4 mt-3 pt-3 border-t border-border text-sm text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">
                {weeklyOrders.reduce((s, d) => s + d.orderCount, 0)}
              </span>{" "}total orders this week
            </span>
            {todayIndex >= 0 && (
              <span>
                <span className="font-semibold text-primary">
                  {weeklyOrders[todayIndex].orderCount}
                </span>{" "}today
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-secondary rounded-xl w-fit">
        <button
          onClick={() => setTab("schedule")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "schedule" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Truck className="w-4 h-4" /> Dispatch Schedule
        </button>
        <button
          onClick={() => setTab("shopify")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "shopify" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <ShoppingBag className="w-4 h-4" /> Product Sales Per Delivery Date
        </button>
      </div>

      {/* Schedule Tab */}
      {tab === "schedule" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {isLoading && <p>Loading orders...</p>}
          {dispatches?.map((order) => {
            const date = new Date(order.dispatchDate);
            const urgency = isPast(date) && order.status === 'pending' ? 'border-destructive shadow-destructive/10' :
              isToday(date) && order.status === 'pending' ? 'border-accent shadow-accent/10' : 'border-border';

            return (
              <div key={order.id} className={`glass-panel p-6 rounded-2xl border-2 ${urgency} relative overflow-hidden`}>
                {order.status === 'dispatched' && (
                  <div className="absolute -right-6 top-6 bg-emerald-500 text-white px-8 py-1 rotate-45 text-xs font-bold uppercase tracking-wider shadow-sm">
                    Shipped
                  </div>
                )}

                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-display font-bold text-xl text-foreground">{order.customer}</h3>
                    <p className="text-sm font-medium text-blue-600 mt-1">{format(date, 'EEEE, MMM do')}</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
                    <Truck className="w-5 h-5" />
                  </div>
                </div>

                <div className="bg-secondary/40 rounded-xl p-4 mb-6">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{order.recipeName}</span>
                    <span className="font-bold text-lg bg-background px-3 py-1 rounded-lg border border-border shadow-sm">x{order.quantity}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {order.status === 'pending' && (
                    <button
                      onClick={() => updateDispatch.mutate({ id: order.id, data: { status: 'dispatched' } })}
                      className="flex-1 py-2 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 font-medium rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-emerald-100 transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Mark Dispatched
                    </button>
                  )}
                  <button
                    onClick={() => { if (confirm('Delete order?')) deleteDispatch.mutate({ id: order.id }) }}
                    className="p-2 text-destructive border border-border rounded-xl hover:bg-destructive hover:text-white transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Shopify Tab */}
      {tab === "shopify" && (
        <div className="space-y-6">
          {/* Date lookup */}
          <div className="glass-panel p-6 rounded-2xl border border-border">
            <h3 className="font-display font-semibold text-lg mb-1">Look up orders by date tag</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Enter a date to count how many of each product appear in Shopify orders tagged with that date.
            </p>
            <div className="space-y-3">
              {/* Row 1: date + fetch */}
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

              {/* Row 2: filters */}
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

          {/* Error */}
          {shopifyError && (
            <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <div>
                <p className="font-medium">Could not fetch Shopify data</p>
                <p className="text-sm opacity-80">{(shopifyError as Error).message}</p>
              </div>
            </div>
          )}

          {/* Results */}
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
                <button
                  onClick={() => refetch()}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RefreshCw className="w-4 h-4" /> Refresh
                </button>
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
      )}
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
