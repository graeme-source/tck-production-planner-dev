// Order analysis (Graeme, 18 Nov 2026; Objective I): every order in the
// period costed under the profit tracker's rules, one row each, so he can
// see which orders make money — small or large, and which products help.
//
// 24 Nov 2026 (Graeme): the order table stops at gross profit — "profit
// contribution" before the shared ads and overheads, which were the same on
// every order and only blurred it. Newest orders first; the order number
// opens it in Shopify; the item count opens what's in it.
//
// Later the same day: "Product cost" is food plus the recipe's own packaging
// (as costed in the app), "Box" is the outer box, insulation and ice; an
// order with an item we have no cost for says so; and the Margin cell is
// shaded against a target margin on the Numbers/Ads colour scale.
//
// Then: "let's take labour out". Labour is a shared period cost, so the
// table stops at Contribution — revenue less product cost, box, courier and
// fees — and Margin is contribution ÷ revenue.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { marginShade } from "@/lib/order-margin-shade";
import { PriceField } from "./tracker-calibration";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShopifyOrderNumber } from "@/components/shopify-order-link";
import { fetchTrackerSettings, gbp, gbp0, pct, dayLabel, saveTrackerSetting, type OrderRow, type Prediction, type TrackerSettings } from "./profit-tracker-api";
import { orderAverages } from "@/lib/order-averages";

type SortKey =
  | "name" | "day" | "items" | "revenue" | "shippingCharged" | "discounts" | "productCost" | "boxCost" | "courier"
  | "paymentFees" | "orderProfit" | "contributionMargin";

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Order" },
  { key: "day", label: "Placed" },
  { key: "items", label: "Items" },
  { key: "revenue", label: "Revenue" },
  { key: "shippingCharged", label: "Shipping" },
  { key: "discounts", label: "Discount" },
  { key: "productCost", label: "Product cost" },
  { key: "boxCost", label: "Box" },
  { key: "courier", label: "Courier" },
  { key: "paymentFees", label: "Fees" },
  { key: "orderProfit", label: "Contribution" },
  { key: "contributionMargin", label: "Margin" },
];

const MONEY = ["revenue", "shippingCharged", "discounts", "productCost", "boxCost", "courier", "paymentFees", "orderProfit"] as const;

/** Sort value: "Placed" sorts by the exact time, so the same day's orders stay in order. */
function sortValue(o: OrderRow, key: SortKey): string | number {
  if (key === "day") return o.createdAt;
  if (key === "contributionMargin") return o.contributionMargin ?? -Infinity;
  return o[key];
}

const PAGE = 200;

export function OrderAnalysis({ data }: { data: Prediction }) {
  // Newest first by default, going back in time.
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "day", asc: false });
  const [open, setOpen] = useState<OrderRow | null>(null);
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["pnl-tracker-settings"], queryFn: fetchTrackerSettings });
  const target = settings.data?.target_order_margin;
  const saveTarget = useMutation({
    mutationFn: (v: number) => saveTrackerSetting("target_order_margin", v),
    onSuccess: (s: TrackerSettings) => qc.setQueryData(["pnl-tracker-settings"], s),
  });
  const [box, setBox] = useState<"all" | "small" | "large">("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = data.orders.filter(o =>
      (box === "all" || o.box === box)
      && (!q || o.name.toLowerCase().includes(q) || o.products.some(p => p.name.toLowerCase().includes(q))),
    );
    return [...filtered].sort((a, b) => {
      const x = sortValue(a, sort.key), y = sortValue(b, sort.key);
      const c = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : Number(x) - Number(y);
      return sort.asc ? c : -c;
    });
  }, [data.orders, box, search, sort]);

  const avg = useMemo(() => orderAverages(rows.slice(0, shown)), [rows, shown]);

  const toggle = (key: SortKey) => setSort(s => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === "name" }));

  return (
    <div className="space-y-4">
      {/* "By order size" and "By product" were taken off this page (Graeme,
         25 Nov 2026: "we don't need them"); bySize/byProduct still feed the API. */}
      {/* Every order */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="p-5 flex flex-wrap items-end justify-between gap-3 border-b border-border">
          <div>
            <h3 className="text-base font-display font-bold">Every order</h3>
            <p className="text-sm text-muted-foreground">
              {rows.length.toLocaleString("en-GB")} orders, newest first · contribution is before labour, ads and overheads
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {target != null && (
              <div className="w-56">
                <PriceField label="Target margin" unit="%" value={target} onSave={v => saveTarget.mutateAsync(v)} />
              </div>
            )}
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setShown(PAGE); }}
              placeholder="Order or product"
              className="h-11 rounded-lg border border-border bg-background px-3 text-sm w-48"
            />
            {(["all", "small", "large"] as const).map(b => (
              <button
                key={b}
                onClick={() => { setBox(b); setShown(PAGE); }}
                className={`h-11 px-4 rounded-lg text-sm font-medium border ${box === b ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-secondary"}`}
              >
                {b === "all" ? "All boxes" : b === "small" ? "Small box" : "Large box"}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-secondary/50">
              <tr>
                {COLUMNS.map(c => (
                  <th key={c.key} className={`px-3 py-2 font-semibold whitespace-nowrap ${c.key === "name" || c.key === "day" ? "text-left" : "text-right"}`}>
                    <button onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 hover:text-primary">
                      {c.label}
                      {sort.key === c.key && (sort.asc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                    </button>
                  </th>
                ))}
              </tr>
              {/* Average of the orders on screen (Graeme, 25 Nov 2026) —
                  £0 resends left out; margin = the orders' margins averaged. */}
              {avg.values && (
                <tr className="border-t border-border bg-primary/5 font-semibold">
                  <td className="px-3 py-2 whitespace-nowrap" colSpan={2}>
                    Average <span className="font-normal text-xs text-muted-foreground">of {avg.count.toLocaleString("en-GB")} order{avg.count === 1 ? "" : "s"} shown</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{avg.values.items.toFixed(1)}</td>
                  {MONEY.map(k => (
                    <td key={k} className="px-3 py-2 text-right whitespace-nowrap">{gbp.format(avg.values![k])}</td>
                  ))}
                  <MarginCell margin={avg.margin} target={target} />
                </tr>
              )}
            </thead>
            <tbody>
              {rows.slice(0, shown).map(o => {
                // A £0 order is a resend: kept in the list but greyed right
                // down, with no reds or margin colour (Graeme, 24 Nov 2026).
                const resend = o.revenue === 0;
                return (
                <tr key={o.id} className={cn("border-t border-border", resend && "text-muted-foreground/50 [&_a]:text-muted-foreground/50 [&_button]:text-muted-foreground/50")} title={resend ? "£0 order — a resend, left out of the colours" : undefined}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    <ShopifyOrderNumber orderId={o.id} name={o.name} />
                    {o.uncostedItems > 0 && (
                      <button
                        onClick={() => setOpen(o)}
                        title={`${o.uncostedItems} item${o.uncostedItems === 1 ? "" : "s"} with no cost — tap to see which`}
                        className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300 align-middle"
                      >
                        <AlertTriangle className="w-3 h-3" /> {o.uncostedItems}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{dayLabel(o.day)}</td>
                  <td className="px-3 py-1 text-right whitespace-nowrap">
                    <button
                      onClick={() => setOpen(o)}
                      title="See what's in this order"
                      className="h-9 min-w-[2.75rem] px-2 rounded-lg font-semibold text-primary underline decoration-dotted underline-offset-2 hover:bg-secondary"
                    >
                      {o.items}{o.box === "large" ? <span className="ml-1 text-xs font-normal text-muted-foreground no-underline">L</span> : null}
                    </button>
                  </td>
                  {MONEY.map(k => (
                    <td key={k} className={`px-3 py-2 text-right whitespace-nowrap ${k === "orderProfit" ? "font-semibold" : ""} ${k === "orderProfit" && o[k] < 0 && !resend ? "text-red-600" : ""}`}>
                      {gbp.format(o[k])}
                    </td>
                  ))}
                  <MarginCell margin={resend ? null : o.contributionMargin} target={target} />
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > shown && (
          <div className="p-4 text-center">
            <button onClick={() => setShown(s => s + PAGE)} className="h-11 px-5 rounded-lg border border-border text-sm font-medium hover:bg-secondary">
              Show {Math.min(PAGE, rows.length - shown)} more of {(rows.length - shown).toLocaleString("en-GB")}
            </button>
          </div>
        )}
        <p className="px-5 pb-4 text-xs text-muted-foreground">
          Totals for the period: {gbp0.format(data.pnl.income)} revenue, {gbp0.format(data.orders.reduce((t, o) => t + o.orderProfit, 0))} contribution.
          {" "}Product cost is each item's recipe ingredients plus its own packaging (tray, film, label), or Shopify's cost for bought-in items; Box is the outer box, insulation and ice.
        </p>
      </div>

      <OrderContents order={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** What's in one order — opened from its item count, closed by clicking away. */
function OrderContents({ order, onClose }: { order: OrderRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!order} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[92dvh] overflow-y-auto">
        {order && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShopifyOrderNumber orderId={order.id} name={order.name} />
                <span className="text-sm font-normal text-muted-foreground">
                  {dayLabel(order.day)}{order.box !== "none" ? ` · ${order.box} box` : ""}
                </span>
              </DialogTitle>
              <DialogDescription>
                {order.items} item{order.items === 1 ? "" : "s"}
              </DialogDescription>
            </DialogHeader>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {order.products.map(p => (
                <li key={p.name} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="w-8 shrink-0 text-right font-semibold tabular-nums">{p.quantity}×</span>
                  <span className="min-w-0 flex-1">{p.name}</span>
                  {!p.costed && (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="w-3 h-3" /> No cost
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-3 gap-2 text-center tabular-nums">
              <div className="rounded-xl bg-secondary/40 p-2">
                <dt className="text-xs text-muted-foreground">Revenue</dt>
                <dd className="font-semibold">{gbp.format(order.revenue)}</dd>
              </div>
              <div className="rounded-xl bg-secondary/40 p-2">
                <dt className="text-xs text-muted-foreground">Contribution</dt>
                <dd className={`font-semibold ${order.orderProfit < 0 ? "text-red-600" : ""}`}>{gbp.format(order.orderProfit)}</dd>
              </div>
              <div className="rounded-xl bg-secondary/40 p-2">
                <dt className="text-xs text-muted-foreground">Margin</dt>
                <dd className={`font-semibold ${(order.contributionMargin ?? 0) < 0 ? "text-red-600" : ""}`}>{pct(order.contributionMargin)}</dd>
              </div>
            </dl>
            {order.uncostedItems > 0 && (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                {order.uncostedItems} item{order.uncostedItems === 1 ? " has" : "s have"} no recipe or Shopify cost, so this order's profit is overstated.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MarginCell({ margin, target }: { margin: number | null; target: number | undefined }) {
  const shade = marginShade(margin, target);
  return (
    <td className="px-2 py-1 text-right whitespace-nowrap">
      <span
        className={cn("inline-block min-w-[4.5rem] rounded-md px-2 py-1.5 font-bold tabular-nums",
          !shade && "text-muted-foreground",
          shade && (shade.darkBackground ? "text-white" : "text-stone-900"))}
        style={shade ? { backgroundColor: shade.hex } : undefined}
        title={target ? `Target ${target}%` : undefined}
      >
        {pct(margin)}
      </span>
    </td>
  );
}
