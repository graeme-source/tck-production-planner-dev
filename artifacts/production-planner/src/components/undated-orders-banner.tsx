/**
 * Dashboard warning for managers: orders with no delivery date (Graeme,
 * 23 Nov 2026). An order more than ten minutes old with no delivery-date tag
 * and no "waiting" tag never reaches a packing list, so it's shown here to be
 * checked. A manager either picks its delivery day (the date tag is written
 * to Shopify for them) or marks it as fine, which takes it off the list for
 * good. Wholesale and 8-pack orders stay on the wholesale list above.
 * Rules: api-server lib/undated-orders-rules.ts.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, Check, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["undated-orders"] as const;

interface UndatedOrder {
  id: number;
  name: string;
  customer: string | null;
  placedAt: string;
  bookedDate: string | null;
  note: string | null;
  items: Array<{ title: string; variant: string | null; quantity: number }>;
  adminUrl: string;
  suggestedDate: string | null;
}
interface Payload { orders: UndatedOrder[]; deliveryDates: string[] }

/** "Tue 24 Nov" for a YYYY-MM-DD day. */
const niceDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** "Mon 23 Nov, 11:52" for when the order was placed. */
const placedWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}/api/undated-orders/${path}`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const failed = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(failed.error ?? `HTTP ${res.status}`);
  }
}

export function UndatedOrdersBanner({ userRole }: { userRole?: string }) {
  const allowed = userRole === "admin" || userRole === "manager";
  const qc = useQueryClient();
  const { data } = useQuery<Payload>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/undated-orders`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: allowed,
    refetchInterval: 60_000,
  });
  // The day picked for each order, until it's saved.
  const [picked, setPicked] = useState<Record<number, string>>({});
  // "Mark as fine" asks once more before it goes for good.
  const [confirming, setConfirming] = useState<number | null>(null);

  const done = () => qc.invalidateQueries({ queryKey: KEY });
  const fail = (e: Error) => toast({ title: "Not done", description: e.message, variant: "destructive" });
  const setDate = useMutation({
    mutationFn: (v: { order: UndatedOrder; deliveryDate: string }) => post(`${v.order.id}/delivery-date`, { deliveryDate: v.deliveryDate }),
    onSuccess: (_r, v) => {
      toast({ title: `${v.order.name} is set for ${niceDay(v.deliveryDate)}`, description: "The delivery date tag has been added in Shopify." });
      return done();
    },
    onError: fail,
  });
  const markFine = useMutation({
    mutationFn: (order: UndatedOrder) => post(`${order.id}/mark-fine`, {}),
    onSuccess: (_r, order) => {
      setConfirming(null);
      toast({ title: `${order.name} marked as fine`, description: "It won't be shown here again." });
      return done();
    },
    onError: fail,
  });

  if (!allowed || !data || data.orders.length === 0) return null;
  const count = data.orders.length;
  const busy = setDate.isPending || markFine.isPending;

  return (
    <div role="alert" className="mb-3 rounded-2xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
      <div>
        <p className="flex items-center gap-2 text-lg font-display font-bold text-amber-900 dark:text-amber-100">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          {count === 1 ? "1 order has no delivery date. Please check it." : `${count} orders have no delivery date. Please check them.`}
        </p>
        <p className="text-sm text-muted-foreground">
          Without a delivery date an order never reaches a packing list. Give it a day, or mark it as fine if it doesn't need sending.
        </p>
      </div>
      <ul className="space-y-3">
        {data.orders.map(order => {
          const day = picked[order.id] ?? order.suggestedDate ?? data.deliveryDates[0] ?? "";
          const saving = setDate.isPending && setDate.variables?.order.id === order.id;
          const marking = markFine.isPending && markFine.variables?.id === order.id;
          return (
            <li key={order.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <b className="text-base">{order.name}</b>
                {order.customer && <span>{order.customer}</span>}
                <span className="text-sm text-muted-foreground">placed {placedWhen(order.placedAt)}</span>
                <a href={order.adminUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-primary underline">
                  Open in Shopify <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
              <p className="text-sm">
                {order.items.map(i => `${i.quantity} × ${i.title}${i.variant ? ` (${i.variant})` : ""}`).join(", ")}
              </p>
              {order.bookedDate && (
                <p className="text-sm text-muted-foreground">The customer booked <b className="text-foreground">{niceDay(order.bookedDate)}</b> at checkout.</p>
              )}
              {order.note && <p className="text-sm text-muted-foreground">Order note: {order.note}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm text-muted-foreground" htmlFor={`undated-day-${order.id}`}>Deliver on</label>
                <select
                  id={`undated-day-${order.id}`}
                  value={day}
                  onChange={e => setPicked(prev => ({ ...prev, [order.id]: e.target.value }))}
                  disabled={busy}
                  className="h-11 px-2 border border-border rounded-lg text-base bg-background"
                >
                  {data.deliveryDates.map(d => <option key={d} value={d}>{niceDay(d)}</option>)}
                </select>
                <button type="button" disabled={busy || !day} onClick={() => setDate.mutate({ order, deliveryDate: day })}
                  className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2 disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />} Set delivery date
                </button>
                {confirming === order.id ? (
                  <>
                    <button type="button" disabled={busy} onClick={() => markFine.mutate(order)}
                      className="h-11 px-4 rounded-xl border-2 border-amber-600 bg-card font-bold flex items-center gap-2 disabled:opacity-50">
                      {marking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Yes, it doesn't need sending
                    </button>
                    <button type="button" disabled={busy} onClick={() => setConfirming(null)}
                      className="h-11 px-3 rounded-xl text-sm font-medium text-muted-foreground disabled:opacity-50">
                      Keep it here
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={busy} onClick={() => setConfirming(order.id)}
                    className="h-11 px-4 rounded-xl border-2 border-border bg-card font-bold flex items-center gap-2 disabled:opacity-50">
                    <Check className="w-4 h-4" /> Mark as fine
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
