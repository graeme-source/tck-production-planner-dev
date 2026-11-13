import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

// Whether an invoice's delivery arrived (Graeme, 13 Nov 2026): shown on the
// invoice in Outstanding and the Invoices library, for the suppliers whose
// invoices are checked against goods-in. Nothing for other suppliers.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type InvoiceDeliveryStatus = "matched" | "matched_by_date" | "quantity_differs" | "waiting" | "no_delivery";

export interface InvoiceDeliveryMatch {
  invoiceId: number;
  supplierId: number;
  status: InvoiceDeliveryStatus;
  needsALook: boolean;
  deliveryId: number | null;
  deliveryDate: string | null;
  gapDays: number | null;
  ageDays: number;
  lateAfterDays: number;
  differences: { name: string; invoiced: number; received: number; unit: string }[];
  unusualAmount: boolean;
  sameAs: { id: number; number: string | null; date: string; total: number | null } | null;
}

export const INVOICE_DELIVERY_STATUS_KEY = ["/api/finance/deliveries/invoice-status"];

export function useInvoiceDeliveryStatus() {
  return useQuery<Record<number, InvoiceDeliveryMatch>>({
    queryKey: INVOICE_DELIVERY_STATUS_KEY,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/finance/deliveries/invoice-status`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    // Fresh every time a page with invoices opens: a supplier just ticked,
    // or lines just read, show straight away.
    refetchOnMount: "always",
    refetchInterval: 60_000,
  });
}

export const ukShortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const qty = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
const amount = (n: number, unit: string) => /^(kg|g|l|ml)$/i.test(unit) ? `${qty(n)} ${unit}` : qty(n);

/** The one line that says what's going on, in plain words. */
export function deliveryMatchText(m: InvoiceDeliveryMatch): string {
  switch (m.status) {
    case "matched":
      return `Delivered ${ukShortDate(m.deliveryDate!)}`;
    case "matched_by_date":
      return `Delivery on ${ukShortDate(m.deliveryDate!)}`;
    case "quantity_differs": {
      const d = m.differences[0];
      return d ? `Invoice says ${amount(d.invoiced, d.unit)} ${d.name} · we received ${amount(d.received, d.unit)}` : "Quantities don't agree";
    }
    case "waiting":
      return "Delivery not in yet";
    case "no_delivery":
      return `No delivery after ${m.ageDays} days`;
  }
}

const TONE: Record<InvoiceDeliveryStatus, string> = {
  matched: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  matched_by_date: "bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200",
  quantity_differs: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  waiting: "bg-secondary text-muted-foreground",
  no_delivery: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
};

/** The status as a small pill. `link` makes it open Finance → Deliveries
 *  (leave it off inside something that's already a button). */
export function InvoiceDeliveryChip({ invoiceId, link, className }: { invoiceId: number; link?: boolean; className?: string }) {
  const { data } = useInvoiceDeliveryStatus();
  const m = data?.[invoiceId];
  if (!m) return null;
  const cls = cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap", TONE[m.status],
    m.needsALook && "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200", link && "hover:underline", className);
  const text = `${deliveryMatchText(m)}${m.unusualAmount ? " · much bigger than usual" : ""}`;
  if (!link) return <span className={cls}>{text}</span>;
  return <Link href={`/finance/deliveries?supplier=${m.supplierId}`} className={cls}>{text}</Link>;
}
