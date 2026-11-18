// Order analysis (Graeme, 18 Nov 2026; Objective I): every order in the
// period costed under the profit tracker's rules, one row each, so he can
// see which orders make money — small or large, and which products help.
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { gbp, gbp0, pct, dayLabel, type OrderRow, type Prediction } from "./profit-tracker-api";

type SortKey =
  | "name" | "day" | "packs" | "revenue" | "shippingCharged" | "discounts" | "food" | "packaging" | "courier"
  | "paymentFees" | "labour" | "grossProfit" | "advertising" | "overhead" | "netProfit" | "margin";

const COLUMNS: Array<{ key: SortKey; label: string; money?: boolean }> = [
  { key: "name", label: "Order" },
  { key: "day", label: "Placed" },
  { key: "packs", label: "Packs" },
  { key: "revenue", label: "Revenue", money: true },
  { key: "shippingCharged", label: "Shipping charged", money: true },
  { key: "discounts", label: "Discount", money: true },
  { key: "food", label: "Food", money: true },
  { key: "packaging", label: "Packaging", money: true },
  { key: "courier", label: "Courier", money: true },
  { key: "paymentFees", label: "Fees", money: true },
  { key: "labour", label: "Labour", money: true },
  { key: "grossProfit", label: "Gross profit", money: true },
  { key: "advertising", label: "Ads", money: true },
  { key: "overhead", label: "Overheads", money: true },
  { key: "netProfit", label: "Net profit", money: true },
  { key: "margin", label: "Margin" },
];

const PAGE = 200;

export function OrderAnalysis({ data }: { data: Prediction }) {
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "netProfit", asc: true });
  const [box, setBox] = useState<"all" | "small" | "large">("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = data.orders.filter(o =>
      (box === "all" || o.box === box)
      && (!q || o.name.toLowerCase().includes(q) || o.products.some(p => p.name.toLowerCase().includes(q))),
    );
    const v = (o: OrderRow) => (sort.key === "margin" ? (o.margin ?? -Infinity) : o[sort.key]);
    return [...filtered].sort((a, b) => {
      const x = v(a), y = v(b);
      const c = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : Number(x) - Number(y);
      return sort.asc ? c : -c;
    });
  }, [data.orders, box, search, sort]);

  const toggle = (key: SortKey) => setSort(s => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === "name" || key === "day" }));

  return (
    <div className="space-y-4">
      {/* Which orders pay: by size */}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="glass-panel rounded-2xl p-5">
          <h3 className="text-base font-display font-bold mb-3">By order size</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium py-2">Size</th>
                  <th className="text-right font-medium py-2">Orders</th>
                  <th className="text-right font-medium py-2">Revenue / order</th>
                  <th className="text-right font-medium py-2">Gross profit / order</th>
                  <th className="text-right font-medium py-2">Net profit / order</th>
                  <th className="text-right font-medium py-2">Margin</th>
                  <th className="text-right font-medium py-2">Share of profit</th>
                </tr>
              </thead>
              <tbody>
                {data.bySize.map(g => (
                  <tr key={g.label} className="border-t border-border">
                    <td className="py-2 font-medium">{g.label}</td>
                    <td className="text-right py-2">{g.orders.toLocaleString("en-GB")}</td>
                    <td className="text-right py-2">{gbp.format(g.revenue)}</td>
                    <td className="text-right py-2">{gbp.format(g.grossProfit)}</td>
                    <td className={`text-right py-2 font-semibold ${g.netProfit < 0 ? "text-red-600" : ""}`}>{gbp.format(g.netProfit)}</td>
                    <td className="text-right py-2">{pct(g.margin)}</td>
                    <td className="text-right py-2">{pct(g.shareOfProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Which products help */}
        <div className="glass-panel rounded-2xl p-5">
          <h3 className="text-base font-display font-bold mb-3">By product</h3>
          <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="sticky top-0 bg-background">
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium py-2">Product</th>
                  <th className="text-right font-medium py-2">Sold</th>
                  <th className="text-right font-medium py-2">Adds per item</th>
                  <th className="text-right font-medium py-2">Orders with it</th>
                  <th className="text-right font-medium py-2">Their net profit</th>
                  <th className="text-right font-medium py-2">Their margin</th>
                </tr>
              </thead>
              <tbody>
                {data.byProduct.map(p => (
                  <tr key={p.name} className="border-t border-border">
                    <td className="py-2 font-medium">{p.name}</td>
                    <td className="text-right py-2">{p.quantity.toLocaleString("en-GB")}</td>
                    <td className="text-right py-2">{p.unitContribution == null ? "no cost" : gbp.format(p.unitContribution)}</td>
                    <td className="text-right py-2">{p.ordersWithIt.toLocaleString("en-GB")}</td>
                    <td className={`text-right py-2 ${p.avgOrderNetProfit < 0 ? "text-red-600" : ""}`}>{gbp.format(p.avgOrderNetProfit)}</td>
                    <td className="text-right py-2">{pct(p.orderMargin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Adds per item: its price less its discount, food and tray. Their net profit: the average order it was in.
          </p>
        </div>
      </div>

      {/* Every order */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="p-5 flex flex-wrap items-end justify-between gap-3 border-b border-border">
          <div>
            <h3 className="text-base font-display font-bold">Every order</h3>
            <p className="text-sm text-muted-foreground">
              {rows.length.toLocaleString("en-GB")} orders · labour {gbp.format(data.pnl.labourPerPack)} a pack, ads {gbp.format(data.pnl.adsPerOrder)} and overheads {gbp.format(data.pnl.overheadPerOrder)} an order
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
                <th className="px-3 py-2 font-semibold text-left">Products</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map(o => (
                <tr key={o.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {o.name}
                    {o.uncostedItems > 0 && <span className="ml-1 text-xs text-amber-700" title="Some items have no cost">•</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{dayLabel(o.day)}</td>
                  <td className="px-3 py-2 text-right">{o.packs}{o.box === "large" ? " L" : ""}</td>
                  {(["revenue", "shippingCharged", "discounts", "food", "packaging", "courier", "paymentFees", "labour", "grossProfit", "advertising", "overhead", "netProfit"] as const).map(k => (
                    <td key={k} className={`px-3 py-2 text-right whitespace-nowrap ${k === "netProfit" || k === "grossProfit" ? "font-semibold" : ""} ${(k === "netProfit" || k === "grossProfit") && o[k] < 0 ? "text-red-600" : ""}`}>
                      {gbp.format(o[k])}
                    </td>
                  ))}
                  <td className={`px-3 py-2 text-right whitespace-nowrap ${(o.margin ?? 0) < 0 ? "text-red-600" : ""}`}>{pct(o.margin)}</td>
                  <td className="px-3 py-2 text-muted-foreground min-w-[16rem]">
                    {o.products.map(p => `${p.quantity}× ${p.name}`).join(", ")}
                  </td>
                </tr>
              ))}
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
          Totals for the period: {gbp0.format(data.pnl.income)} revenue, {gbp0.format(data.pnl.netProfit)} net profit.
        </p>
      </div>
    </div>
  );
}
