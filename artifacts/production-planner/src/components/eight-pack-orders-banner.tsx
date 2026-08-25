import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PackageCheck, Loader2, AlertTriangle, CheckCircle2, ArrowRight, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface QueueLine {
  lineId: number;
  productTitle: string | null;
  variantTitle: string | null;
  quantity: number;
  recipeId: number | null;
  recipeName: string | null;
}
interface QueueOrder {
  orderId: number;
  name: string;
  customerName: string;
  tags: string;
  kind: "eight_pack" | "wholesale_2pack";
  existingDateTag: string | null;
  proposedDeliveryDate: string;
  lines: QueueLine[];
}
interface PlanInfo { planId: number; planDate: string; status: string; recipeIds: number[]; }
interface QueuePayload {
  generatedAt: string;
  today: string;
  // First day bags may be produced: today before the 7 a.m. London cutoff,
  // tomorrow after it. Optional so an older cached server response degrades
  // to the previous behaviour (today).
  earliestProductionDate?: string;
  deliveryDates: string[];
  plansByDespatchDate: Record<string, PlanInfo>;
  orders: QueueOrder[];
}

const DEFAULT_8PACK_ROLES: Record<string, boolean> = { admin: true, manager: true, employee: false, viewer: false };

function use8PackBannerRoles() {
  const [roles, setRoles] = useState<Record<string, boolean>>(DEFAULT_8PACK_ROLES);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch(`${BASE}/api/app-settings/dashboard_8pack_banner_roles`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.value) { try { setRoles({ ...DEFAULT_8PACK_ROLES, ...JSON.parse(d.value) }); } catch { /* keep defaults */ } } })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  return { roles, loaded };
}

// ── date helpers (string math, UTC-noon) ──
function addDaysStr(s: string, n: number): string {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtNice(s: string): string {
  return new Date(`${s}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

type OrderStatus =
  | { ok: true; planId: number; despatchDate: string; productionDate: string; tagOnly?: boolean }
  | { ok: false; reason: string };

// Bags don't have to be made on the despatch day — any plan from 1 to 3 days
// before delivery can carry them (Graeme, 2026-08). This checks ONE candidate
// production date for an order.
function evaluateProduction(order: QueueOrder, productionDate: string, plans: Record<string, PlanInfo>): OrderStatus {
  const plan = plans[productionDate];
  if (!plan) return { ok: false, reason: `No production plan for ${fmtNice(productionDate)}` };
  const planRecipes = new Set(plan.recipeIds);
  const unmapped = order.lines.filter(l => l.recipeId == null);
  if (unmapped.length) return { ok: false, reason: `Unrecognised product: ${unmapped.map(l => l.productTitle ?? "?").join(", ")}` };
  const missing = order.lines.filter(l => l.recipeId != null && !planRecipes.has(l.recipeId));
  if (missing.length) return { ok: false, reason: `Not on the ${fmtNice(plan.planDate)} plan: ${[...new Set(missing.map(l => l.recipeName))].join(", ")}` };
  return { ok: true, planId: plan.planId, despatchDate: "", productionDate };
}

function evaluate(order: QueueOrder, deliveryDate: string, productionDate: string, plans: Record<string, PlanInfo>): OrderStatus {
  // Wholesale 2-pack-only orders are tag-only: no plan needed, always ready once a
  // delivery day is chosen (the 2-packs reach the plan via the normal order sync).
  if (order.kind === "wholesale_2pack") {
    return { ok: true, planId: -1, despatchDate: addDaysStr(deliveryDate, -1), productionDate: addDaysStr(deliveryDate, -1), tagOnly: true };
  }
  const status = evaluateProduction(order, productionDate, plans);
  if (!status.ok) return status;
  return { ...status, despatchDate: addDaysStr(deliveryDate, -1) };
}

// Candidate production days for a delivery: despatch day (delivery − 1) back
// to delivery − 3, never before the earliest production day (today before the
// 7 a.m. cutoff, tomorrow after it — Graeme, 2026-08-25). Earliest first.
function productionCandidates(deliveryDate: string, earliestProduction: string): string[] {
  const out: string[] = [];
  for (let back = 3; back >= 1; back--) {
    const d = addDaysStr(deliveryDate, -back);
    if (d >= earliestProduction) out.push(d);
  }
  return out;
}

// Default production day: the EARLIEST candidate whose plan already has every
// product on it — make it as soon as possible. When none qualifies, default
// to delivery − 2 (produce and chill one day, wrap/pack/despatch the next)
// rather than the despatch day itself: producing, wrapping and despatching
// all on the same day is a squeeze reserved for when time has run out
// (Graeme, 2026-08-20). Falls back to the despatch day only when delivery − 2
// is before the earliest production day.
function defaultProductionDate(order: QueueOrder, deliveryDate: string, earliestProduction: string, plans: Record<string, PlanInfo>): string {
  const candidates = productionCandidates(deliveryDate, earliestProduction);
  for (const d of candidates) {
    if (evaluateProduction(order, d, plans).ok) return d;
  }
  const dayBeforeDespatch = addDaysStr(deliveryDate, -2);
  return dayBeforeDespatch >= earliestProduction ? dayBeforeDespatch : addDaysStr(deliveryDate, -1);
}

export function EightPackOrdersBanner({ userRole }: { userRole?: string }) {
  const { roles, loaded: rolesLoaded } = use8PackBannerRoles();
  const [data, setData] = useState<QueuePayload | null>(null);
  const [open, setOpen] = useState(false);
  const allowed = rolesLoaded && !!userRole && roles[userRole] === true;

  async function fetchQueue() {
    try {
      const res = await fetch(`${BASE}/api/wholesale-bags/queue`, { credentials: "include" });
      if (!res.ok) return;
      setData(await res.json());
    } catch (err) {
      console.warn("[8PackBanner] fetch failed:", err);
    }
  }

  useEffect(() => {
    if (!allowed) return;
    fetchQueue();
    const interval = setInterval(fetchQueue, 30000);
    return () => clearInterval(interval);
  }, [allowed]);

  if (!allowed || !data || data.orders.length === 0) return null;

  const count = data.orders.length;
  const eightCount = data.orders.filter(o => o.kind === "eight_pack").length;
  const wholesaleCount = count - eightCount;
  const banner = [
    eightCount > 0 ? `${eightCount} 8-pack` : null,
    wholesaleCount > 0 ? `${wholesaleCount} wholesale` : null,
  ].filter(Boolean).join(" + ");

  return (
    <div className="sticky top-0 z-20 -mx-6 px-6 pb-2 pt-0 bg-background/80 backdrop-blur-sm">
      <div className="rounded-xl border border-indigo-300 dark:border-indigo-800 bg-card overflow-hidden shadow-sm">
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-2 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-950/30 border-b border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100/70 dark:hover:bg-indigo-900/30 transition-colors text-left"
        >
          <PackageCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
            {count} order{count !== 1 ? "s" : ""} to process <span className="font-normal text-indigo-600/70 dark:text-indigo-400/70">({banner})</span>
          </span>
          <span className="ml-auto flex items-center gap-1 text-xs font-medium text-indigo-600/70 dark:text-indigo-400/70">
            Review &amp; process <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </button>
      </div>

      {open && (
        <ReviewDialog
          data={data}
          onClose={() => setOpen(false)}
          onProcessed={fetchQueue}
        />
      )}
    </div>
  );
}

function ReviewDialog({ data, onClose, onProcessed }: { data: QueuePayload; onClose: () => void; onProcessed: () => void }) {
  const earliestProduction = data.earliestProductionDate ?? data.today;
  // per-order selected delivery date
  const [selected, setSelected] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    for (const o of data.orders) init[o.orderId] = o.proposedDeliveryDate;
    return init;
  });
  // per-order selected production day — defaults to the EARLIEST plan (within
  // delivery − 3 … − 1) that already has all the order's products on it.
  const [selectedProduction, setSelectedProduction] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    for (const o of data.orders) init[o.orderId] = defaultProductionDate(o, o.proposedDeliveryDate, data.earliestProductionDate ?? data.today, data.plansByDespatchDate);
    return init;
  });
  const [processing, setProcessing] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());

  const changeDelivery = (order: QueueOrder, deliveryDate: string) => {
    setSelected(prev => ({ ...prev, [order.orderId]: deliveryDate }));
    // Re-derive the best production day for the new delivery date.
    setSelectedProduction(prev => ({
      ...prev,
      [order.orderId]: defaultProductionDate(order, deliveryDate, earliestProduction, data.plansByDespatchDate),
    }));
  };

  async function processOrder(order: QueueOrder) {
    const deliveryDate = selected[order.orderId];
    const productionDate = selectedProduction[order.orderId];
    setProcessing(order.orderId);
    try {
      const res = await fetch(`${BASE}/api/wholesale-bags/process`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId, deliveryDate, productionDate }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: `Processed ${order.name}`,
          description: order.kind === "eight_pack"
            ? `Bags on the ${fmtNice(productionDate)} plan · delivering ${fmtNice(deliveryDate)}.`
            : `Tagged for delivery ${fmtNice(deliveryDate)}.`,
        });
        setDone(prev => new Set(prev).add(order.orderId));
        onProcessed();
      } else if (res.status === 207) {
        toast({ title: `${order.name}: tagged, but check bags`, description: body.warning ?? "Some bags need adding manually.", variant: "destructive" });
        setDone(prev => new Set(prev).add(order.orderId));
        onProcessed();
      } else {
        const detail = body.recipesNotOnPlan?.length
          ? `Not on plan: ${body.recipesNotOnPlan.join(", ")}`
          : body.unmappedProducts?.length
            ? `Unrecognised: ${body.unmappedProducts.join(", ")}`
            : body.error ?? "Could not process.";
        toast({ title: `Couldn't process ${order.name}`, description: detail, variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Process failed", description: err instanceof Error ? err.message : "Network error", variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  }

  const remaining = data.orders.filter(o => !done.has(o.orderId));
  const readyCount = remaining.filter(o => evaluate(o, selected[o.orderId], selectedProduction[o.orderId], data.plansByDespatchDate).ok).length;
  const eightPackOrders = data.orders.filter(o => o.kind === "eight_pack");
  const wholesaleOrders = data.orders.filter(o => o.kind === "wholesale_2pack");

  async function processAllReady() {
    for (const o of remaining) {
      if (evaluate(o, selected[o.orderId], selectedProduction[o.orderId], data.plansByDespatchDate).ok) {
        // sequential to keep Shopify writes orderly
        // eslint-disable-next-line no-await-in-loop
        await processOrder(o);
      }
    }
  }

  const renderCard = (order: QueueOrder) => {
    const isDone = done.has(order.orderId);
    const delivery = selected[order.orderId];
    const production = selectedProduction[order.orderId];
    const status = evaluate(order, delivery, production, data.plansByDespatchDate);
    const isWholesale = order.kind === "wholesale_2pack";
    const prodCandidates = productionCandidates(delivery, earliestProduction);
    // merge the proposed date into options if it's outside the standard window
    const options = data.deliveryDates.includes(order.proposedDeliveryDate)
      ? data.deliveryDates
      : [order.proposedDeliveryDate, ...data.deliveryDates];
    return (
      <div
        key={order.orderId}
        className={cn(
          "rounded-xl border p-3",
          isDone ? "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 opacity-70"
            : status.ok ? "border-border bg-card"
              : "border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/10",
        )}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="min-w-0">
            <span className="font-semibold">{order.name}</span>
            {order.customerName && <span className="text-sm text-muted-foreground ml-2">{order.customerName}</span>}
            {order.existingDateTag && (
              <span className="text-xs ml-2 px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">requested {fmtNice(order.existingDateTag)}</span>
            )}
          </div>
          {isDone && <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm mb-2">
          {order.lines.map(l => (
            <span key={l.lineId} className={cn(!isWholesale && l.recipeId == null && "text-amber-600 dark:text-amber-400")}>
              <span className="font-bold tabular-nums">{l.quantity}×</span> {l.recipeName ?? l.productTitle ?? "?"}
              {isWholesale
                ? l.variantTitle && <span className="text-muted-foreground"> · {l.variantTitle}</span>
                : l.recipeId == null && " (unrecognised)"}
            </span>
          ))}
        </div>

        {!isDone && (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm text-muted-foreground">Deliver</label>
            <select
              value={delivery}
              onChange={e => changeDelivery(order, e.target.value)}
              className="px-2 py-1.5 border border-border rounded-lg text-sm bg-background"
            >
              {options.map(d => <option key={d} value={d}>{fmtNice(d)}</option>)}
            </select>

            {!isWholesale && (
              <>
                <label className="text-sm text-muted-foreground">Make</label>
                <select
                  value={production}
                  onChange={e => setSelectedProduction(prev => ({ ...prev, [order.orderId]: e.target.value }))}
                  className="px-2 py-1.5 border border-border rounded-lg text-sm bg-background"
                  title="Which production plan the bags go on — up to 3 days before delivery. Defaults to the earliest plan that already has these products."
                >
                  {prodCandidates.map(d => {
                    const s = evaluateProduction(order, d, data.plansByDespatchDate);
                    return (
                      <option key={d} value={d}>
                        {fmtNice(d)}{s.ok ? "" : ` — ${data.plansByDespatchDate[d] ? "missing products" : "no plan"}`}
                      </option>
                    );
                  })}
                </select>
              </>
            )}

            {status.ok ? (
              <span className="text-xs text-muted-foreground">
                {status.tagOnly
                  ? `→ tag ${fmtNice(delivery)} + production`
                  : `→ bags on the ${fmtNice(production)} plan · delivers ${fmtNice(delivery)}`}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {status.reason}
              </span>
            )}

            <button
              onClick={() => processOrder(order)}
              disabled={!status.ok || processing === order.orderId}
              className="ml-auto flex items-center gap-1.5 text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {processing === order.orderId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageCheck className="w-3.5 h-3.5" />}
              Process
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-indigo-500" /> Process 8-pack &amp; wholesale orders
          </DialogTitle>
          <DialogDescription>
            Pick a delivery day (Tue–Sat) for each order. <span className="font-medium">8-pack bag orders</span> add the bags to a production plan up to 3 days before delivery — Make defaults to the earliest plan that already has the products, and you can change it. <span className="font-medium">Wholesale 2-pack orders</span> are just tagged for despatch. Both get tagged with the delivery date + <span className="font-medium">production</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {eightPackOrders.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center gap-2 pb-1 border-b border-indigo-200 dark:border-indigo-800">
                <PackageCheck className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                <h3 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">8-pack bag orders</h3>
                <span className="text-xs text-muted-foreground">{eightPackOrders.length}</span>
              </div>
              <div className="space-y-3">{eightPackOrders.map(renderCard)}</div>
            </section>
          )}

          {wholesaleOrders.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center gap-2 pb-1 border-b border-teal-200 dark:border-teal-800">
                <Store className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                <h3 className="text-sm font-semibold text-teal-700 dark:text-teal-300">Wholesale 2-pack only orders</h3>
                <span className="text-xs text-muted-foreground">{wholesaleOrders.length}</span>
              </div>
              <p className="text-xs text-muted-foreground">No 8-pack bags — processing just tags these with the delivery date + production. The production plan isn't changed.</p>
              <div className="space-y-3">{wholesaleOrders.map(renderCard)}</div>
            </section>
          )}
        </div>

        {readyCount > 1 && (
          <div className="flex justify-end pt-2 border-t border-border">
            <button
              onClick={processAllReady}
              disabled={processing !== null}
              className="flex items-center gap-1.5 text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {processing !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
              Process all ready ({readyCount})
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
