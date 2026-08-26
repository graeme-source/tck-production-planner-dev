/**
 * Book APC consignments for a dispatch day, in whatever size batch the
 * operator chooses.
 *
 * The danger is not booking — it's a partial run nobody notices, leaving
 * some orders without a label and no way to tell which. So the flow is:
 *
 *   1. PREFLIGHT — nothing is booked. Shows what would be booked, what is
 *                  blocked, what needs a human look, what is already done.
 *                  Orders are TICKED INDIVIDUALLY; nothing is selected by
 *                  default, so a full run is a deliberate act.
 *   2. CONFIRM   — a second explicit step naming the exact count and the
 *                  service-code mix.
 *   3. REPORT    — every order's own outcome, failures first, copyable.
 *
 * Nothing is booked without the operator seeing stages 1 and 2.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, PackageCheck,
  Truck, ClipboardCopy, ShieldAlert, CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RescheduleOrderDialog } from "@/components/reschedule-order-dialog";
import { OrderNumber } from "@/components/order-number";
import { AddressReviewCard, type PreflightAddress, type AddressReviewFlag } from "@/components/apc-address-review";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export interface PreflightOrder {
  orderId: number;
  orderName: string;
  customerName: string;
  serviceCode: string | null;
  boxCategory: "small box" | "large box" | "wholesale" | "other";
  weightKg: number;
  existingWaybill: string | null;
  problems: string[];
  reviews: string[];
  /** Present on orders whose address needed reshaping — carries the dropped
   *  text and how much it matters, so the card can rank and show it. */
  reviewFlags?: AddressReviewFlag[];
  /** What Shopify holds vs what the label will carry. */
  address?: PreflightAddress;
}

interface Preflight {
  tag: string;
  codesConfigured: boolean;
  counts: { total: number; ready: number; needsReview: number; blocked: number; alreadyBooked: number; localDeliveries: number; notTagged?: number };
  ready: PreflightOrder[];
  needsReview: PreflightOrder[];
  blocked: PreflightOrder[];
  alreadyBooked: PreflightOrder[];
  localDeliveries: PreflightOrder[];
  /** Unfulfilled orders on this day that have NOT been approved for
   *  dispatch. Never bookable — the server refuses them too. Listed so the
   *  operator can see what still needs tagging (Graeme, 2026-08-29). */
  notTagged?: PreflightOrder[];
}

interface BookResult {
  orderId: number;
  orderName: string;
  /** Deep link into the Shopify admin, built server-side. Lets a failure be
   *  opened and assessed without hunting for the order by hand. */
  adminUrl?: string;
  status: "booked" | "skipped" | "failed";
  waybill?: string;
  serviceCode?: string;
  reference?: string;
  reason?: string;
  recordError?: string;
  usedServiceCode?: string;
  /** Standard same-day code offered as a one-tap retry when the failure
   *  looks like a service-availability rejection (e.g. Lightweight refused
   *  for an Isle of Wight postcode while ND is accepted). */
  suggestedRetryCode?: string;
  /** Set when APC refused on coverage grounds and the order was marked in
   *  Shopify so it can be found there later. */
  taggedNoService?: boolean;
}

interface BookResponse {
  tag: string;
  booked: number;
  skipped: number;
  failed: number;
  recordErrors: number;
  results: BookResult[];
}

type Tone = "ready" | "review" | "blocked" | "done";

function OrderLine({ o, tone, selectable, checked, onToggle, adminBase }: {
  o: PreflightOrder; tone: Tone; selectable?: boolean; checked?: boolean; onToggle?: () => void;
  adminBase?: string;
}) {
  const body = (
    <>
      {/* The order number links into Shopify wherever it appears — assessing
          anything on this screen ends up there. */}
      <OrderNumber
        orderId={o.orderId}
        name={o.orderName}
        adminBase={adminBase}
        className="font-mono font-bold w-[5.5rem] shrink-0"
      />
      <span className="flex-1 min-w-0">
        <span className="text-muted-foreground">{o.customerName}</span>
        {(o.problems.length > 0 || o.reviews.length > 0) && (
          <span className={cn("block text-sm mt-0.5", tone === "blocked" ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
            {[...o.problems, ...o.reviews].join(" · ")}
          </span>
        )}
        {o.existingWaybill && (
          <span className="block text-sm text-muted-foreground font-mono mt-0.5">{o.existingWaybill}</span>
        )}
      </span>
      <span className="text-sm text-muted-foreground shrink-0 text-right">
        {o.serviceCode && <span className="font-mono">{o.serviceCode}</span>}
        <span className="block">{o.weightKg} kg</span>
      </span>
    </>
  );

  if (!selectable) {
    return <div className="flex items-start gap-3 py-2 text-base border-b border-border/50 last:border-0">{body}</div>;
  }

  return (
    <label className={cn(
      "flex items-start gap-3 py-2.5 text-base border-b border-border/50 last:border-0 cursor-pointer -mx-1 px-1 rounded-lg",
      checked && "bg-primary/5",
    )}>
      {/* Big enough to hit with a gloved finger on an iPad. */}
      <input type="checkbox" checked={!!checked} onChange={onToggle} className="mt-1 shrink-0 w-5 h-5 accent-primary" />
      {body}
    </label>
  );
}

function Section({ title, count, tone, orders, defaultOpen = false, selectable, selected, onToggle, adminBase }: {
  title: string; count: number; tone: Tone; orders: PreflightOrder[]; defaultOpen?: boolean;
  selectable?: boolean; selected?: Set<number>; onToggle?: (id: number) => void;
  adminBase?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  const toneClass = {
    ready: "border-green-300 dark:border-green-800 bg-green-50/60 dark:bg-green-950/20",
    review: "border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20",
    blocked: "border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20",
    done: "border-border bg-secondary/30",
  }[tone];
  const chosen = selectable && selected ? orders.filter(o => selected.has(o.orderId)).length : 0;
  return (
    <div className={cn("rounded-2xl border-2 overflow-hidden", toneClass)}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2.5 px-4 py-3 text-base font-bold text-left">
        {tone === "ready" && <CheckCircle2 className="w-5 h-5 text-green-600" />}
        {tone === "review" && <AlertTriangle className="w-5 h-5 text-amber-600" />}
        {tone === "blocked" && <XCircle className="w-5 h-5 text-red-600" />}
        {tone === "done" && <PackageCheck className="w-5 h-5 text-muted-foreground" />}
        {title}
        <span className="ml-auto tabular-nums text-muted-foreground font-semibold">
          {selectable && chosen > 0 ? `${chosen} of ${count} ticked` : count}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 max-h-80 overflow-y-auto">
          {orders.map(o => (
            <OrderLine
              key={o.orderId}
              o={o}
              tone={tone}
              selectable={selectable}
              checked={selected?.has(o.orderId)}
              onToggle={() => onToggle?.(o.orderId)}
              adminBase={adminBase}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ApcBatchBookingDialog({ tag, onClose, onBooked, adminBase }: {
  tag: string;
  onClose: () => void;
  onBooked: () => void;
  /** Shopify admin order base, sent once from /config-status. Makes every
   *  order number here a link into the order. */
  adminBase?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"review" | "confirm" | "booking" | "report">("review");
  const [report, setReport] = useState<BookResponse | null>(null);
  // Which failed row has its reschedule dialog open. One at a time by
  // design — each customer gets a personally addressed email.
  const [rescheduling, setRescheduling] = useState<BookResult | null>(null);
  // One-tap retry of a failed row on a different service code. The result
  // row is replaced in place and the summary counts recomputed.
  const [retryingOrderId, setRetryingOrderId] = useState<number | null>(null);
  async function retryWithCode(row: BookResult, code: string) {
    setRetryingOrderId(row.orderId);
    try {
      const res = await fetch(`${BASE}/api/fulfilment/batch-book`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, orderIds: [row.orderId], serviceCodeOverride: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Retry failed");
      const replacement = (data as BookResponse).results.find(r => r.orderId === row.orderId);
      if (replacement) {
        setReport(prev => {
          if (!prev) return prev;
          const results = prev.results.map(r => (r.orderId === row.orderId ? replacement : r));
          return {
            ...prev,
            results,
            booked: results.filter(r => r.status === "booked").length,
            skipped: results.filter(r => r.status === "skipped").length,
            failed: results.filter(r => r.status === "failed").length,
            recordErrors: results.filter(r => r.recordError).length,
          };
        });
        if (replacement.status === "booked") {
          toast({ title: `${row.orderName} booked on ${code}` });
          onBooked();
        } else {
          toast({ title: `${row.orderName} still failing on ${code}`, description: replacement.reason, variant: "destructive" });
        }
      }
    } catch (e) {
      toast({ title: "Retry failed", description: e instanceof Error ? e.message : "Request failed", variant: "destructive" });
    } finally {
      setRetryingOrderId(null);
    }
  }
  // Nothing ticked to begin with: booking the whole wave has to be chosen,
  // not defaulted into.
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // React Query rather than a bare fetch so that saving an address
  // correction can invalidate this key and the row moves itself out of
  // "needs a look" without the operator reopening the dialog.
  const {
    data: preflight = null,
    isLoading: loading,
    error: preflightError,
  } = useQuery<Preflight>({
    queryKey: ["apc-batch-preflight", tag],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/fulfilment/batch-preflight?tag=${encodeURIComponent(tag)}`, { credentials: "include" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Preflight failed");
      return d as Preflight;
    },
    // Nothing here should be served from cache: it decides what gets booked.
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const selectable: PreflightOrder[] = preflight ? [...preflight.ready, ...preflight.needsReview] : [];
  const toBook = selectable.filter(o => selected.has(o.orderId));
  // Orders whose address a person has already re-cut. They are "ready" as far
  // as booking is concerned; this is the record of the change, and the only
  // route back to the automatic address.
  const correctedReady = preflight ? preflight.ready.filter(o => o.address?.corrected) : [];
  const [showCorrected, setShowCorrected] = useState(false);

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** Tick the first N bookable orders — the way to run a small trial batch
   *  without hunting through a list of 150. */
  function selectFirst(n: number) {
    setSelected(new Set(preflight!.ready.slice(0, n).map(o => o.orderId)));
  }

  /** Tick every ready order of a box size — so large boxes can be booked
   *  first as a trial run, then the smalls (Graeme, 2026-08-21). Wholesale
   *  counts as large: it books on the large service code. */
  function selectBySize(size: "small" | "large") {
    const match = (o: PreflightOrder) => size === "small"
      ? o.boxCategory === "small box"
      : o.boxCategory === "large box" || o.boxCategory === "wholesale";
    setSelected(new Set(preflight!.ready.filter(match).map(o => o.orderId)));
  }
  const readySmallCount = preflight ? preflight.ready.filter(o => o.boxCategory === "small box").length : 0;
  const readyLargeCount = preflight ? preflight.ready.filter(o => o.boxCategory === "large box" || o.boxCategory === "wholesale").length : 0;

  async function book() {
    if (toBook.length === 0) return;
    setStage("booking");
    try {
      const res = await fetch(`${BASE}/api/fulfilment/batch-book`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, orderIds: toBook.map(o => o.orderId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Booking failed");
      setReport(data as BookResponse);
      setStage("report");
      onBooked();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Booking failed");
      setStage("review");
    }
  }

  function copyReport() {
    if (!report) return;
    const lines = report.results.map(r =>
      `${r.orderName}\t${r.status}\t${r.waybill ?? ""}\t${r.serviceCode ?? ""}\t${r.reason ?? ""}${r.recordError ? `\tNOT RECORDED: ${r.recordError}` : ""}`,
    );
    navigator.clipboard.writeText(`APC batch booking — ${report.tag}\n${lines.join("\n")}`)
      .then(() => toast({ title: "Report copied" }))
      .catch(() => toast({ title: "Could not copy", variant: "destructive" }));
  }

  // One shared style for the pick chips — they are all the same kind of
  // control, so they should not each carry their own size.
  const chipClass = "px-4 py-2 rounded-xl text-base font-semibold border-2 border-border hover:bg-secondary/60 disabled:opacity-40";

  const quickPick = (n: number) => (
    <button
      key={n}
      onClick={() => selectFirst(n)}
      disabled={!preflight || preflight.ready.length === 0}
      className={chipClass}
    >
      First {n}
    </button>
  );

  return (
    <Dialog open onOpenChange={(v) => { if (!v && stage !== "booking" && !rescheduling) onClose(); }}>
      <DialogContent
        // Wide and tall: this screen carries addresses that have to be read
        // and compared, on an iPad, at the bench. The old 2xl width forced
        // them to wrap mid-line, which is what made them hard to read
        // (Graeme, 2026-08-26).
        className="max-w-4xl max-h-[92vh] overflow-y-auto"
        // The reschedule dialog renders over this one. Radix decides
        // "clicked outside" on POINTERDOWN, which fires before click — so
        // pressing a button in the child dialog tore this one down, unmounting
        // the child before its click handler ran. The button looked like it
        // did nothing because it genuinely never fired (2026-08-21, #133063).
        onPointerDownOutside={e => { if (rescheduling) e.preventDefault(); }}
        onInteractOutside={e => { if (rescheduling) e.preventDefault(); }}
        onEscapeKeyDown={e => { if (rescheduling) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-xl">
            <PackageCheck className="w-6 h-6 text-primary" /> Book APC consignments — {tag}
          </DialogTitle>
          <DialogDescription className="text-base">
            {stage === "report"
              ? "Every order's outcome is listed below. Anything that failed still has no label."
              : "Tick the orders to book. Nothing is booked until you confirm on the next step."}
          </DialogDescription>
        </DialogHeader>

        {loading && <div className="flex items-center gap-2.5 text-base text-muted-foreground py-6"><Loader2 className="w-5 h-5 animate-spin" /> Checking the day's orders…</div>}

        {(error || preflightError) && (
          <div className="flex items-start gap-2.5 text-base text-destructive bg-destructive/10 rounded-xl px-4 py-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error ?? (preflightError instanceof Error ? preflightError.message : "Preflight failed")}</span>
          </div>
        )}

        {/* ── Stage 1: review + pick ── */}
        {preflight && stage === "review" && (
          <div className="space-y-4">
            {!preflight.codesConfigured && (
              <div className="flex items-start gap-2.5 text-base text-destructive bg-destructive/10 rounded-xl px-4 py-3">
                <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span>APC service codes aren't configured in Settings — nothing can be booked.</span>
              </div>
            )}

            {preflight.ready.length > 0 && (
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-base font-semibold text-muted-foreground">Quick pick:</span>
                {[5].map(quickPick)}
                <button
                  onClick={() => setSelected(new Set(preflight.ready.map(o => o.orderId)))}
                  className={chipClass}
                >
                  All ready ({preflight.ready.length})
                </button>
                <button
                  onClick={() => selectBySize("small")}
                  disabled={readySmallCount === 0}
                  className={chipClass}
                >
                  Small boxes ({readySmallCount})
                </button>
                <button
                  onClick={() => selectBySize("large")}
                  disabled={readyLargeCount === 0}
                  className={chipClass}
                  title="Includes wholesale — they book on the large-box service code"
                >
                  Large boxes ({readyLargeCount})
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  disabled={selected.size === 0}
                  className={chipClass}
                >
                  Clear
                </button>
              </div>
            )}

            {/* Tagging is step one: a label commits us to shipping, so it
                can't run ahead of the approval. These orders are shown, not
                offered — the API skips them too. */}
            {(preflight.counts.notTagged ?? 0) > 0 && (
              <div className="flex items-start gap-2.5 text-base rounded-xl border-2 border-orange-400 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 px-4 py-3">
                <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5 text-orange-600" />
                <span className="text-orange-900 dark:text-orange-200">
                  <strong>{preflight.counts.notTagged} order(s) aren't tagged for dispatch yet</strong> and
                  can't be booked. Tag them on the packing screen first, then reopen this.
                </span>
              </div>
            )}

            {/* ── Addresses that need a decision ──────────────────────────
                One card per order rather than a row in a list: each is a
                judgement to make, not an item to scan past, and the card
                carries everything that judgement needs — before, after, what
                is being dropped, and the means to change it. Shown ABOVE
                "Ready to book" because it is the only part of this screen
                that asks anything of the operator. */}
            {preflight.needsReview.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  <h3 className="text-base font-bold">
                    {preflight.needsReview.length} address{preflight.needsReview.length !== 1 ? "es" : ""} won't fit the label as written
                  </h3>
                </div>
                <p className="text-base text-muted-foreground">
                  Fix the address, or tick the order to book it as it stands.
                </p>
                {preflight.needsReview.map(o => (
                  <div key={o.orderId} className="space-y-2">
                    {o.address ? (
                      <AddressReviewCard
                        orderId={o.orderId}
                        orderName={o.orderName}
                        customerName={o.customerName}
                        address={o.address}
                        flags={o.reviewFlags ?? []}
                        adminBase={adminBase}
                        onSaved={onBooked}
                      />
                    ) : (
                      // No structured address (an older server, or a flag
                      // that isn't about the address). Never drop the order
                      // silently — show what we have.
                      <div className="rounded-2xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-4">
                        <OrderNumber orderId={o.orderId} name={o.orderName} adminBase={adminBase} className="font-mono text-lg font-bold" />
                        <p className="text-base text-amber-800 dark:text-amber-300 mt-1">{o.reviews.join(" · ")}</p>
                      </div>
                    )}
                    <label className={cn(
                      "flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 cursor-pointer text-base font-medium",
                      selected.has(o.orderId)
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-secondary/50",
                    )}>
                      <input
                        type="checkbox"
                        checked={selected.has(o.orderId)}
                        onChange={() => toggle(o.orderId)}
                        className="w-5 h-5 shrink-0 accent-primary"
                      />
                      Book {o.orderName} {o.address?.corrected ? "with the fixed address" : "anyway"}
                    </label>
                  </div>
                ))}
              </div>
            )}

            {/* Corrected addresses pass every check, so they sit in "Ready to
                book" below and are ticked from there. They also need somewhere
                to be checked and undone — a fix made in haste is otherwise
                irreversible. Closed by default: once an address is sorted it
                should stop taking up room. */}
            {correctedReady.length > 0 && (
              <div className="rounded-2xl border-2 border-green-300 dark:border-green-800 bg-green-50/60 dark:bg-green-950/20 overflow-hidden">
                <button
                  onClick={() => setShowCorrected(v => !v)}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-base font-bold text-left"
                >
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  Addresses you've fixed
                  <span className="ml-auto tabular-nums text-muted-foreground font-semibold">
                    {showCorrected ? "Hide" : `${correctedReady.length} — view or undo`}
                  </span>
                </button>
                {showCorrected && (
                  <div className="px-4 pb-4 space-y-3">
                    <p className="text-base text-muted-foreground">
                      These are ready to book, and are listed again below with everything else.
                    </p>
                    {correctedReady.map(o => (
                      <AddressReviewCard
                        key={o.orderId}
                        orderId={o.orderId}
                        orderName={o.orderName}
                        customerName={o.customerName}
                        address={o.address!}
                        flags={o.reviewFlags ?? []}
                        adminBase={adminBase}
                        onSaved={onBooked}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <Section title="Ready to book" count={preflight.counts.ready} tone="ready" orders={preflight.ready} defaultOpen
              selectable selected={selected} onToggle={toggle} adminBase={adminBase} />
            <Section title="Can't be booked — fix in Shopify first" count={preflight.counts.blocked} tone="blocked" orders={preflight.blocked} defaultOpen adminBase={adminBase} />
            <Section title="Not tagged for dispatch — tag before booking" count={preflight.counts.notTagged ?? 0} tone="blocked" orders={preflight.notTagged ?? []} adminBase={adminBase} />
            <Section title="Already booked" count={preflight.counts.alreadyBooked} tone="done" orders={preflight.alreadyBooked} adminBase={adminBase} />
            <Section title="Local delivery — no label needed" count={preflight.counts.localDeliveries} tone="done" orders={preflight.localDeliveries} adminBase={adminBase} />

            {/* Pinned outside the scrolling area: the green button used to be
                buried under the panel behind this dialog, and the only way to
                reach it was to resize the window (Graeme, 2026-08-26). */}
            <div className="flex items-center gap-3 pt-3 border-t-2 border-border sticky bottom-0 bg-background">
              <span className="text-base text-muted-foreground">
                {toBook.length === 0 ? "Nothing ticked" : <><strong className="text-foreground">{toBook.length}</strong> order{toBook.length !== 1 ? "s" : ""} ticked</>}
              </span>
              <div className="flex-1" />
              <button onClick={onClose} className="px-5 py-2.5 border-2 border-border rounded-xl text-base font-medium hover:bg-secondary/50">Cancel</button>
              <button
                onClick={() => setStage("confirm")}
                disabled={toBook.length === 0 || !preflight.codesConfigured}
                className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-base font-bold hover:bg-primary/90 disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ── Stage 2: the second, explicit confirmation ── */}
        {preflight && stage === "confirm" && (
          <div className="space-y-4">
            <div className="rounded-xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-2">
              <p className="font-bold text-lg text-amber-900 dark:text-amber-200 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> Raise {toBook.length} real consignment{toBook.length !== 1 ? "s" : ""} with APC?
              </p>
              <p className="text-sm text-amber-900/90 dark:text-amber-200/90">
                These are chargeable and will appear in Hypaship immediately. Orders already holding a
                consignment are skipped automatically, so nothing is double-booked.
              </p>
              <div className="text-xs text-amber-900/80 dark:text-amber-200/80 font-mono pt-1">
                {Object.entries(toBook.reduce<Record<string, number>>((acc, o) => {
                  const k = o.serviceCode ?? "?"; acc[k] = (acc[k] ?? 0) + 1; return acc;
                }, {})).map(([code, n]) => `${code} × ${n}`).join("   ")}
              </div>
              <div className="text-xs text-amber-900/70 dark:text-amber-200/70 pt-1 max-h-24 overflow-y-auto">
                {toBook.map(o => o.orderName).join(", ")}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setStage("review")} className="px-4 py-2 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50">Back</button>
              <div className="flex-1" />
              <button onClick={book} className="px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700">
                Yes — book {toBook.length} now
              </button>
            </div>
          </div>
        )}

        {stage === "booking" && (
          <div className="flex items-center gap-3 py-8 text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span>Booking {toBook.length} consignment{toBook.length !== 1 ? "s" : ""} with APC — don't close this window…</span>
          </div>
        )}

        {/* ── Stage 3: the report ── */}
        {report && stage === "report" && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 py-2">
                <div className="text-2xl font-bold text-green-700 dark:text-green-300">{report.booked}</div>
                <div className="text-xs text-muted-foreground">booked</div>
              </div>
              <div className="rounded-xl border border-border bg-secondary/30 py-2">
                <div className="text-2xl font-bold">{report.skipped}</div>
                <div className="text-xs text-muted-foreground">skipped</div>
              </div>
              <div className={cn("rounded-xl border py-2", report.failed > 0 ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30" : "border-border bg-secondary/30")}>
                <div className={cn("text-2xl font-bold", report.failed > 0 && "text-red-700 dark:text-red-300")}>{report.failed}</div>
                <div className="text-xs text-muted-foreground">failed</div>
              </div>
            </div>

            {report.recordErrors > 0 && (
              <div className="flex items-start gap-2 text-sm rounded-xl border-2 border-red-400 bg-red-50 dark:bg-red-950/30 px-3 py-2.5">
                <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-600" />
                <span className="text-red-900 dark:text-red-200">
                  <strong>{report.recordErrors} consignment(s) were booked with APC but could not be saved here.</strong> Note
                  their numbers from the list below before closing — the app cannot see them and could book them again.
                </span>
              </div>
            )}

            <div className="rounded-xl border border-border divide-y divide-border max-h-72 overflow-y-auto">
              {[...report.results].sort((a, b) => (a.status === "failed" ? -1 : b.status === "failed" ? 1 : 0)).map(r => (
                <div key={r.orderId} className="flex items-start gap-3 px-3 py-2 text-sm">
                  {r.status === "booked" && <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />}
                  {r.status === "skipped" && <Truck className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
                  {r.status === "failed" && <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />}
                  {/* The order number is the way into Shopify — a failure is
                      almost always assessed there, and hunting for the order
                      by hand is the slow part. Opens in a new tab so the
                      report stays put while several are checked. */}
                  {r.adminUrl ? (
                    <a
                      href={r.adminUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold w-[4.5rem] shrink-0 text-primary hover:underline"
                      title={`Open ${r.orderName} in Shopify`}
                    >
                      {r.orderName}
                    </a>
                  ) : (
                    <span className="font-semibold w-[4.5rem] shrink-0">{r.orderName}</span>
                  )}
                  <span className="flex-1 min-w-0">
                    {r.waybill && <span className="font-mono text-xs">{r.waybill}</span>}
                    {r.reference && r.reference !== r.orderName && (
                      <span className="text-xs text-muted-foreground"> · ref {r.reference}</span>
                    )}
                    {r.reason && <span className={cn("block text-xs", r.status === "failed" ? "text-destructive" : "text-muted-foreground")}>{r.reason}</span>}
                    {r.recordError && <span className="block text-xs text-red-600 font-semibold">NOT SAVED LOCALLY — write this number down</span>}
                    {r.taggedNoService && (
                      <span className="block text-xs text-muted-foreground">Tagged <code className="font-mono">apc-no-service</code> in Shopify</span>
                    )}
                  </span>
                  {r.serviceCode && <span className="text-xs font-mono text-muted-foreground shrink-0">{r.serviceCode}</span>}
                  {/* A failure here is usually a postcode that genuinely can't
                      take this delivery day. Rescheduling is the resolution,
                      so it belongs on the row rather than somewhere else. One
                      at a time — each customer gets their own email. */}
                  {r.status === "failed" && r.suggestedRetryCode && (
                    <button
                      onClick={() => retryWithCode(r, r.suggestedRetryCode!)}
                      disabled={retryingOrderId === r.orderId}
                      className="shrink-0 text-xs px-2 py-1 rounded-lg border border-blue-400 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 inline-flex items-center gap-1 disabled:opacity-50"
                      title={`This route may not take ${r.usedServiceCode ?? "the chosen service"} — retry the booking on ${r.suggestedRetryCode}`}
                    >
                      {retryingOrderId === r.orderId ? <Loader2 className="w-3 h-3 animate-spin" /> : <PackageCheck className="w-3 h-3" />}
                      Retry as {r.suggestedRetryCode}
                    </button>
                  )}
                  {r.status === "failed" && (
                    <button
                      onClick={() => setRescheduling(r)}
                      className="shrink-0 text-xs px-2 py-1 rounded-lg border border-amber-400 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 inline-flex items-center gap-1"
                      title="Move this order to a later delivery date and email the customer"
                    >
                      <CalendarClock className="w-3 h-3" /> Reschedule
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button onClick={copyReport} className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50">
                <ClipboardCopy className="w-3.5 h-3.5" /> Copy report
              </button>
              <div className="flex-1" />
              <button onClick={onClose} className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90">Done</button>
            </div>
          </div>
        )}
      </DialogContent>

      {/* Rendered outside the report list so it survives the list re-sorting
          underneath it. `tag` is the dispatch day being booked, which is the
          date the order is moving OFF. */}
      {rescheduling && (
        <RescheduleOrderDialog
          orderId={rescheduling.orderId}
          orderName={rescheduling.orderName}
          fromDate={tag}
          adminUrl={rescheduling.adminUrl}
          onClose={() => setRescheduling(null)}
          onDone={() => {
            // The order has left this dispatch day — mark it so in the report
            // rather than leaving a stale "failed" row the operator might act
            // on twice.
            setReport(prev => prev && ({
              ...prev,
              results: prev.results.map(r =>
                r.orderId === rescheduling.orderId
                  ? { ...r, status: "skipped" as const, reason: "Rescheduled — moved off this dispatch day" }
                  : r),
            }));
            onBooked();
          }}
        />
      )}
    </Dialog>
  );
}
