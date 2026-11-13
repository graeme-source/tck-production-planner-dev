import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronDown, ExternalLink, Loader2, Truck } from "lucide-react";
import { INVOICE_DELIVERY_STATUS_KEY, ukShortDate, type InvoiceDeliveryMatch } from "@/components/invoice-delivery-chip";

// Finance → Deliveries (Graeme, 13 Nov 2026): every goods-in delivery as a
// delivery note — who took it in, when, what came — and, for the suppliers
// ticked, which invoice it was for. Invoices worth a look sit at the top;
// everything else is quiet. Objectives F and I.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface InvoiceBrief { id: number; number: string | null; date: string; total: number | null; supplierName: string | null }

interface DeliveriesResponse {
  reading: number;
  suppliers: {
    id: number; name: string; enabled: boolean;
    counts: { matched: number; waiting: number; toLook: number } | null;
    ratios: { name: string; ratio: number }[];
    typicalGapDays: number | null; lateAfterDays: number | null;
  }[];
  toLook: { invoice: InvoiceBrief; match: InvoiceDeliveryMatch }[];
  deliveries: {
    id: number; supplierId: number; supplierName: string; receivedAt: string; receivedBy: string | null;
    chilledTempC: number | null; frozenTempC: number | null; notes: string | null; checked: boolean;
    lines: { name: string; unit: string | null; ordered: number | null; received: number | null; nativeReceived: number; ingredientUnit: string | null }[];
    invoice: (InvoiceBrief & { status: string | null }) | null;
  }[];
}

const gbp = (n: number | null) => n == null ? "" : n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
const qty = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
/** "15.68 kg", or just "1,200" for things counted one by one. */
const amount = (n: number, unit: string) => /^(kg|g|l|ml)$/i.test(unit) ? `${qty(n)} ${unit}` : qty(n);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

function usualGap(days: number | null): string {
  if (days == null) return "";
  if (days === 0) return "usually delivers the day it invoices";
  if (days > 0) return `usually delivers ${days} day${days === 1 ? "" : "s"} after invoicing`;
  return `usually invoices ${-days} day${days === -1 ? "" : "s"} after delivering`;
}

const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "include", ...init });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

type Filter = "all" | "matched" | "unmatched";

export function DeliveriesPanel() {
  const search = new URLSearchParams(useSearch());
  const [days, setDays] = useState(30);
  const [supplierId, setSupplierId] = useState<number | null>(Number(search.get("supplier")) || null);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const qs = `days=${days}${supplierId ? `&supplierId=${supplierId}` : ""}`;
  const q = useQuery<DeliveriesResponse>({
    queryKey: ["/api/finance/deliveries", qs],
    queryFn: () => jsonFetch(`${BASE}/api/finance/deliveries?${qs}`),
    refetchInterval: (query) => ((query.state.data as DeliveriesResponse | undefined)?.reading ?? 0) > 0 ? 8000 : false,
  });
  const data = q.data;
  const gapOf = (id: number) => data?.suppliers.find((s) => s.id === id)?.typicalGapDays ?? null;
  // Matched / no invoice only make sense for the suppliers being checked.
  const rows = (data?.deliveries ?? []).filter((d) =>
    filter === "all" ? true : filter === "matched" ? d.checked && d.invoice != null : d.checked && d.invoice == null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          {[7, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={supplierId ?? ""} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)} aria-label="Supplier">
          <option value="">All suppliers</option>
          {data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Invoice match">
          <option value="all">Matched and unmatched</option>
          <option value="matched">Invoice matched</option>
          <option value="unmatched">No invoice yet</option>
        </select>
        {data && <span className="text-sm text-muted-foreground">{rows.length} deliver{rows.length === 1 ? "y" : "ies"}</span>}
        {(data?.reading ?? 0) > 0 && (
          <span className="text-sm text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" /> Reading {data!.reading} invoice{data!.reading === 1 ? "" : "s"}</span>
        )}
      </div>

      {q.isLoading && <div className="text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading deliveries…</div>}
      {q.error && <div className="text-destructive">{(q.error as Error).message}</div>}

      {data && data.toLook.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-bold">Invoices to look at</h2>
          {data.toLook.map(({ invoice, match }) => <LookRow key={invoice.id} invoice={invoice} match={match} gap={gapOf(match.supplierId)} />)}
        </section>
      )}

      {data && (
        <section className="space-y-2">
          <h2 className="text-base font-bold">Delivery notes</h2>
          {rows.length === 0 && <p className="text-muted-foreground">No deliveries here.</p>}
          {rows.map((d) => (
            <DeliveryRow key={d.id} d={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} />
          ))}
        </section>
      )}

      {data && <SuppliersChecked suppliers={data.suppliers} />}
    </div>
  );
}

function lookReasons(match: InvoiceDeliveryMatch, gap: number | null): string[] {
  const reasons: string[] = [];
  if (match.status === "no_delivery") {
    reasons.push(`No delivery recorded in the ${match.ageDays} days since${gap != null ? ` — this supplier ${usualGap(gap)}` : ""}.`);
  } else if (match.status === "quantity_differs") {
    for (const d of match.differences) reasons.push(`Invoice says ${amount(d.invoiced, d.unit)} ${d.name} · we received ${amount(d.received, d.unit)}${match.deliveryDate ? ` on ${ukShortDate(match.deliveryDate)}` : ""}.`);
  }
  if (match.unusualAmount) reasons.push("Much bigger than this supplier's usual invoice.");
  if (match.sameAs) reasons.push(`Same amount as invoice ${match.sameAs.number ?? ""} on ${ukShortDate(match.sameAs.date)}, which did have a delivery.`);
  return reasons;
}

function LookRow({ invoice, match, gap }: { invoice: InvoiceBrief; match: InvoiceDeliveryMatch; gap: number | null }) {
  return (
    <Card className="border-amber-300 bg-amber-50/60 dark:bg-amber-950/20">
      <div className="flex items-start gap-3 px-4 py-2.5">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium break-words">{invoice.supplierName}</span>
            <span className="text-xs text-muted-foreground">{ukShortDate(invoice.date)}{invoice.number ? ` · ${invoice.number}` : ""}</span>
          </div>
          <div className="text-sm">{lookReasons(match, gap).join(" ")}</div>
        </div>
        <a href={`${BASE}/api/finance/invoices/${invoice.id}/file`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline inline-flex items-center gap-1 shrink-0 mt-0.5">
          View invoice <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <div className="font-semibold tabular-nums shrink-0 w-24 text-right">{gbp(invoice.total)}</div>
      </div>
    </Card>
  );
}

/** Matched / no invoice yet, for the suppliers being checked; nothing for the rest. */
function MatchMarker({ d }: { d: DeliveriesResponse["deliveries"][number] }) {
  if (!d.checked) return null;
  if (!d.invoice) return <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold bg-secondary text-muted-foreground whitespace-nowrap">No invoice yet</span>;
  const differs = d.invoice.status === "quantity_differs";
  return (
    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
      differs ? "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200" : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200")}>
      {differs ? "Invoice differs" : "Invoice matched"}{d.invoice.number ? ` · ${d.invoice.number}` : ""}
    </span>
  );
}

function DeliveryRow({ d, open, onToggle }: { d: DeliveriesResponse["deliveries"][number]; open: boolean; onToggle: () => void }) {
  return (
    <Card className={cn("transition-colors", open ? "border-primary/50" : "hover:border-primary/50")}>
      <button onClick={onToggle} aria-expanded={open} className="w-full text-left">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="h-9 w-9 rounded-xl bg-secondary flex items-center justify-center shrink-0 text-muted-foreground"><Truck className="h-4 w-4" /></div>
          <div className="flex-1 min-w-0">
            <div className="font-medium break-words">{d.supplierName}</div>
            <div className="text-xs text-muted-foreground">{when(d.receivedAt)}{d.receivedBy ? ` · taken in by ${d.receivedBy}` : ""}</div>
          </div>
          <span className="hidden sm:inline text-sm text-muted-foreground shrink-0">{d.lines.length} item{d.lines.length === 1 ? "" : "s"}</span>
          <MatchMarker d={d} />
          <div className="font-semibold tabular-nums shrink-0 w-24 text-right">{d.invoice ? gbp(d.invoice.total) : ""}</div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t space-y-3">
          <ul className="text-sm space-y-1 pt-2">
            {d.lines.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="tabular-nums font-semibold shrink-0">{l.received != null ? qty(l.received) : "–"} {l.unit ?? ""}</span>
                <span className="break-words">{l.name}</span>
                {l.ordered != null && l.received != null && Math.abs(l.ordered - l.received) > 0.001 && (
                  <span className="text-muted-foreground shrink-0">(ordered {qty(l.ordered)})</span>
                )}
              </li>
            ))}
          </ul>
          {(d.chilledTempC != null || d.frozenTempC != null || d.notes) && (
            <div className="text-sm text-muted-foreground">
              {d.chilledTempC != null && <span className="mr-3">Chilled {d.chilledTempC}°C</span>}
              {d.frozenTempC != null && <span className="mr-3">Frozen {d.frozenTempC}°C</span>}
              {d.notes && <span className="break-words">{d.notes}</span>}
            </div>
          )}
          {d.invoice && (
            <a href={`${BASE}/api/finance/invoices/${d.invoice.id}/file`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
              Invoice {d.invoice.number ?? ""} · {ukShortDate(d.invoice.date)} · {gbp(d.invoice.total)} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}
    </Card>
  );
}

function SuppliersChecked({ suppliers }: { suppliers: DeliveriesResponse["suppliers"] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => jsonFetch(`${BASE}/api/finance/deliveries/suppliers/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/deliveries"] });
      queryClient.invalidateQueries({ queryKey: INVOICE_DELIVERY_STATUS_KEY });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer font-semibold">Suppliers whose invoices are checked ({suppliers.filter((s) => s.enabled).length})</summary>
      <ul className="mt-3 divide-y">
        {suppliers.map((s) => (
          <li key={s.id} className="py-3 flex items-start gap-3">
            <Switch
              checked={s.enabled}
              disabled={toggle.isPending}
              onCheckedChange={(enabled) => toggle.mutate({ id: s.id, enabled })}
              aria-label={`Check ${s.name}'s invoices against deliveries`}
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium">{s.name}</div>
              {s.enabled && s.counts && (
                <div className="text-sm text-muted-foreground">
                  {sentence([usualGap(s.typicalGapDays), `${s.counts.matched} matched`, s.counts.waiting ? `${s.counts.waiting} waiting` : "", s.counts.toLook ? `${s.counts.toLook} to look at` : ""].filter(Boolean).join(" · "))}
                </div>
              )}
              {s.enabled && s.ratios.map((r) => (
                <div key={r.name} className="text-sm text-muted-foreground">
                  {r.name}: their invoices count {qty(r.ratio)} for every 1 we record at goods-in — treated as normal.
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

