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

const schema = z.object({
  recipeId: z.coerce.number().min(1),
  dispatchDate: z.string(),
  quantity: z.coerce.number().min(1),
  customer: z.string().min(1),
  status: z.enum(['pending', 'dispatched', 'cancelled'])
});

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ShopifyOrderSummary {
  tag: string;
  orderCount: number;
  products: Array<{
    productTitle: string;
    variants: string[];
    totalQuantity: number;
    orderCount: number;
  }>;
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

  const { register, handleSubmit, reset } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { dispatchDate: format(new Date(), 'yyyy-MM-dd'), quantity: 10, status: 'pending' as const, customer: "" }
  });

  const { data: shopifyData, isLoading: shopifyLoading, error: shopifyError, refetch } = useQuery({
    queryKey: ["shopify-order-summary", queryTag],
    queryFn: () => fetchShopifyOrderSummary(queryTag!),
    enabled: !!queryTag,
  });

  const sortedProducts = useMemo(() => {
    if (!shopifyData?.products) return [];
    const filterLower = variantFilter.trim().toLowerCase();
    const filtered = filterLower
      ? shopifyData.products.filter(p =>
          (p.variants ?? []).some(v => v.toLowerCase().includes(filterLower))
        )
      : shopifyData.products;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortCol === "product") cmp = a.productTitle.localeCompare(b.productTitle);
      else if (sortCol === "orders") cmp = a.orderCount - b.orderCount;
      else if (sortCol === "qty") cmp = a.totalQuantity - b.totalQuantity;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [shopifyData, sortCol, sortDir, variantFilter]);

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
          <ShoppingBag className="w-4 h-4" /> Shopify Orders
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
              <div className="flex-1 min-w-[180px] max-w-xs">
                <label className="text-sm font-medium mb-1 block">Filter by variant</label>
                <div className="relative">
                  <input
                    type="text"
                    value={variantFilter}
                    onChange={(e) => setVariantFilter(e.target.value)}
                    placeholder="e.g. 2 Pack"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring pr-8"
                  />
                  {variantFilter && (
                    <button
                      onClick={() => setVariantFilter("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      title="Clear filter"
                    >
                      ×
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {variantFilter ? "Showing products with matching variant" : "Showing all variants"}
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
                    {variantFilter ? ` matching "${variantFilter}"` : ""}
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
                            {(p.variants ?? []).length > 0 ? (p.variants ?? []).join(", ") : "—"}
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
