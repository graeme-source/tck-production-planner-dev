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
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, PackageCheck,
  Truck, ClipboardCopy, ShieldAlert, CalendarClock, RotateCcw, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mergeRows, countRows, replaceRow } from "@/lib/booking-report";
import { RescheduleOrderDialog } from "@/components/reschedule-order-dialog";
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
}

interface Preflight {
  tag: string;
  codesConfigured: boolean;
  counts: { total: number; ready: number; needsReview: number; blocked: number; alreadyBooked: number; localDeliveries: number; collections?: number; notTagged?: number };
  ready: PreflightOrder[];
  needsReview: PreflightOrder[];
  blocked: PreflightOrder[];
  alreadyBooked: PreflightOrder[];
  localDeliveries: PreflightOrder[];
  collections?: PreflightOrder[];
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
  /** The failure is something to correct on the order itself and try again,
   *  rather than a coverage refusal or a problem at our end. */
  dataFixable?: boolean;
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

function OrderLine({ o, tone, selectable, checked, onToggle }: {
  o: PreflightOrder; tone: Tone; selectable?: boolean; checked?: boolean; onToggle?: () => void;
}) {
  const body = (
    <>
      <span className="font-semibold w-[4.5rem] shrink-0">{o.orderName}</span>
      <span className="flex-1 min-w-0">
        <span className="text-muted-foreground">{o.customerName}</span>
        {(o.problems.length > 0 || o.reviews.length > 0) && (
          <span className={cn("block text-xs mt-0.5", tone === "blocked" ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
            {[...o.problems, ...o.reviews].join(" · ")}
          </span>
        )}
        {o.existingWaybill && (
          <span className="block text-xs text-muted-foreground font-mono mt-0.5">{o.existingWaybill}</span>
        )}
      </span>
      <span className="text-xs text-muted-foreground shrink-0 text-right">
        {o.serviceCode && <span className="font-mono">{o.serviceCode}</span>}
        <span className="block">{o.weightKg} kg</span>
      </span>
    </>
  );

  if (!selectable) {
    return <div className="flex items-start gap-3 py-1.5 text-sm border-b border-border/50 last:border-0">{body}</div>;
  }

  return (
    <label className={cn(
      "flex items-start gap-3 py-1.5 text-sm border-b border-border/50 last:border-0 cursor-pointer -mx-1 px-1 rounded",
      checked && "bg-primary/5",
    )}>
      <input type="checkbox" checked={!!checked} onChange={onToggle} className="mt-1 shrink-0" />
      {body}
    </label>
  );
}

function Section({ title, count, tone, orders, defaultOpen = false, selectable, selected, onToggle }: {
  title: string; count: number; tone: Tone; orders: PreflightOrder[]; defaultOpen?: boolean;
  selectable?: boolean; selected?: Set<number>; onToggle?: (id: number) => void;
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
    <div className={cn("rounded-xl border overflow-hidden", toneClass)}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-sm font-semibold text-left">
        {tone === "ready" && <CheckCircle2 className="w-4 h-4 text-green-600" />}
        {tone === "review" && <AlertTriangle className="w-4 h-4 text-amber-600" />}
        {tone === "blocked" && <XCircle className="w-4 h-4 text-red-600" />}
        {tone === "done" && <PackageCheck className="w-4 h-4 text-muted-foreground" />}
        {title}
        <span className="ml-auto tabular-nums text-muted-foreground">
          {selectable && chosen > 0 ? `${chosen} of ${count} ticked` : count}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2 max-h-60 overflow-y-auto">
          {orders.map(o => (
            <OrderLine
              key={o.orderId}
              o={o}
              tone={tone}
              selectable={selectable}
              checked={selected?.has(o.orderId)}
              onToggle={() => onToggle?.(o.orderId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ApcBatchBookingDialog({ tag, onClose, onBooked }: {
  tag: string;
  onClose: () => void;
  onBooked: () => void;
}) {
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"review" | "confirm" | "booking" | "report">("review");
  const [report, setReport] = useState<BookResponse | null>(null);
  // Which failed row has its reschedule dialog open. One at a time by
  // design — each customer gets a personally addressed email.
  const [rescheduling, setRescheduling] = useState<BookResult | null>(null);
  // ── Retry ───────────────────────────────────────────────────────────────
  // A failure here is usually something to go and FIX on the order — an
  // over-long Delivery City, a missing postcode — and then try again. Before
  // this, fixing it meant closing the report and running the whole booking
  // flow from the top, which also lost the record of what else had happened
  // (Graeme, 2026-09-03).
  //
  // Every retry re-reads the order from Shopify server-side, so it sees the
  // correction: nothing from the original batch is reused but the order id.
  // `retry: true` also turns on the courier-side duplicate check, so a
  // consignment APC raised but never told us about is reused, not doubled.
  //
  // One retry at a time — every button locks while any is in flight, because
  // two overlapping runs would race on the same report.
  const [retryingOrderId, setRetryingOrderId] = useState<number | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const retryBusy = retryingOrderId !== null || retryingAll;

  /** Fold fresh outcomes into the report and recompute the counters. */
  function applyResults(replacements: BookResult[]) {
    setReport(prev => {
      if (!prev) return prev;
      const results = mergeRows(prev.results, replacements);
      return { ...prev, results, ...countRows(results) };
    });
  }

  async function runRetry(rowsToRetry: BookResult[], code?: string): Promise<BookResult[]> {
    const res = await fetch(`${BASE}/api/fulfilment/batch-book`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag,
        orderIds: rowsToRetry.map(r => r.orderId),
        retry: true,
        ...(code ? { serviceCodeOverride: code } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Retry failed");
    return (data as BookResponse).results;
  }

  /** Retry one row — on its auto-picked service code, or on `code` when the
   *  server suggested a different one. */
  async function retryRow(row: BookResult, code?: string) {
    setRetryingOrderId(row.orderId);
    try {
      const replacement = (await runRetry([row], code)).find(r => r.orderId === row.orderId);
      if (!replacement) {
        toast({ title: `No outcome came back for ${row.orderName}`, variant: "destructive" });
        return;
      }
      applyResults([replacement]);
      const on = code ? ` on ${code}` : "";
      if (replacement.status === "booked") {
        toast({ title: `${row.orderName} booked${on}` });
        onBooked();
      } else if (replacement.status === "skipped") {
        toast({ title: `${row.orderName} — ${replacement.reason ?? "skipped"}` });
        onBooked();
      } else {
        toast({ title: `${row.orderName} still failing${on}`, description: replacement.reason, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Retry failed", description: e instanceof Error ? e.message : "Request failed", variant: "destructive" });
    } finally {
      setRetryingOrderId(null);
    }
  }

  /** Retry every failure in one pass — after a round of fixes in Shopify. */
  async function retryAllFailed(rowsToRetry: BookResult[]) {
    setRetryingAll(true);
    try {
      const replacements = await runRetry(rowsToRetry);
      applyResults(replacements);
      const nowBooked = replacements.filter(r => r.status === "booked").length;
      const stillFailing = replacements.filter(r => r.status === "failed").length;
      toast({
        title: stillFailing === 0
          ? `All ${replacements.length} booked`
          : `${nowBooked} booked · ${stillFailing} still failing`,
        ...(stillFailing > 0 ? { variant: "destructive" as const } : {}),
      });
      if (nowBooked > 0) onBooked();
    } catch (e) {
      toast({ title: "Retry failed", description: e instanceof Error ? e.message : "Request failed", variant: "destructive" });
    } finally {
      setRetryingAll(false);
    }
  }
  // Nothing ticked to begin with: booking the whole wave has to be chosen,
  // not defaulted into.
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/fulfilment/batch-preflight?tag=${encodeURIComponent(tag)}`, { credentials: "include" })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Preflight failed");
        if (!cancelled) setPreflight(d);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Preflight failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tag]);

  const selectable: PreflightOrder[] = preflight ? [...preflight.ready, ...preflight.needsReview] : [];
  const toBook = selectable.filter(o => selected.has(o.orderId));

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

  /** Rows worth a retry: every failure, plus an order skipped only because it
   *  hadn't been approved yet — tag it on the packing screen, then retry from
   *  here instead of running the booking flow again (Graeme, 2026-09-03).
   *  Deliberately NOT an order already holding a consignment, a local
   *  delivery, or one rescheduled off the day: there is nothing to retry. */
  const canRetry = (r: BookResult) =>
    r.status === "failed"
    || (r.status === "skipped" && (r.reason ?? "").toLowerCase().startsWith("not tagged for dispatch"));
  const retryableRows = report?.results.filter(canRetry) ?? [];

  const quickPick = (n: number) => (
    <button
      key={n}
      onClick={() => selectFirst(n)}
      disabled={!preflight || preflight.ready.length === 0}
      className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border hover:bg-secondary/60 disabled:opacity-40"
    >
      First {n}
    </button>
  );

  return (
    <Dialog open onOpenChange={(v) => { if (!v && stage !== "booking" && !rescheduling) onClose(); }}>
      <DialogContent
        className="max-w-2xl max-h-[88vh] overflow-y-auto"
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
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-primary" /> Book APC consignments — {tag}
          </DialogTitle>
          <DialogDescription>
            {stage === "report"
              ? "Every order's outcome is listed below. Anything that failed still has no label."
              : "Tick the orders to book. Nothing is booked until you confirm on the next step."}
          </DialogDescription>
        </DialogHeader>

        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="w-4 h-4 animate-spin" /> Checking the day's orders…</div>}

        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {/* ── Stage 1: review + pick ── */}
        {preflight && stage === "review" && (
          <div className="space-y-3">
            {!preflight.codesConfigured && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2.5">
                <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>APC service codes aren't configured in Settings — nothing can be booked.</span>
              </div>
            )}

            {preflight.ready.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="text-muted-foreground">Quick pick:</span>
                {[5].map(quickPick)}
                <button
                  onClick={() => setSelected(new Set(preflight.ready.map(o => o.orderId)))}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border hover:bg-secondary/60"
                >
                  All ready ({preflight.ready.length})
                </button>
                <button
                  onClick={() => selectBySize("small")}
                  disabled={readySmallCount === 0}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border hover:bg-secondary/60 disabled:opacity-40"
                >
                  Small boxes ({readySmallCount})
                </button>
                <button
                  onClick={() => selectBySize("large")}
                  disabled={readyLargeCount === 0}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border hover:bg-secondary/60 disabled:opacity-40"
                  title="Includes wholesale — they book on the large-box service code"
                >
                  Large boxes ({readyLargeCount})
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  disabled={selected.size === 0}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border hover:bg-secondary/60 disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            )}

            {/* Tagging is step one: a label commits us to shipping, so it
                can't run ahead of the approval. These orders are shown, not
                offered — the API skips them too. */}
            {(preflight.counts.notTagged ?? 0) > 0 && (
              <div className="flex items-start gap-2 text-sm rounded-xl border-2 border-orange-400 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 px-3 py-2.5">
                <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-orange-600" />
                <span className="text-orange-900 dark:text-orange-200">
                  <strong>{preflight.counts.notTagged} order(s) aren't tagged for dispatch yet</strong> and
                  can't be booked. Tag them on the packing screen first, then reopen this.
                </span>
              </div>
            )}

            <Section title="Ready to book" count={preflight.counts.ready} tone="ready" orders={preflight.ready} defaultOpen
              selectable selected={selected} onToggle={toggle} />
            <Section title="Needs a look before booking" count={preflight.counts.needsReview} tone="review" orders={preflight.needsReview} defaultOpen
              selectable selected={selected} onToggle={toggle} />
            <Section title="Can't be booked — fix in Shopify first" count={preflight.counts.blocked} tone="blocked" orders={preflight.blocked} defaultOpen />
            <Section title="Not tagged for dispatch — tag before booking" count={preflight.counts.notTagged ?? 0} tone="blocked" orders={preflight.notTagged ?? []} />
            <Section title="Already booked" count={preflight.counts.alreadyBooked} tone="done" orders={preflight.alreadyBooked} />
            <Section title="Local delivery — no label needed" count={preflight.counts.localDeliveries} tone="done" orders={preflight.localDeliveries} />
            <Section title="Collection — brown paper bag, never APC" count={preflight.counts.collections ?? 0} tone="done" orders={preflight.collections ?? []} />

            {preflight.counts.needsReview > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Orders under "needs a look" can be ticked too — read their notes first. Their addresses
                were reshaped to fit the label.
              </p>
            )}

            <div className="flex items-center gap-3 pt-2 border-t border-border">
              <span className="text-sm text-muted-foreground">
                {toBook.length === 0 ? "Nothing ticked" : <><strong className="text-foreground">{toBook.length}</strong> order{toBook.length !== 1 ? "s" : ""} ticked</>}
              </span>
              <div className="flex-1" />
              <button onClick={onClose} className="px-4 py-2 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50">Cancel</button>
              <button
                onClick={() => setStage("confirm")}
                disabled={toBook.length === 0 || !preflight.codesConfigured}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-40"
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

            {/* Fix a few orders in Shopify, then re-check them all in one
                press. Only worth showing for more than one failure — with a
                single failure its own Retry is right there on the row. */}
            {retryableRows.length > 1 && (
              <div className="flex items-center gap-3 rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/20 px-3 py-2.5">
                <RotateCcw className="w-4 h-4 shrink-0 text-blue-600" />
                <span className="text-sm text-blue-900 dark:text-blue-200 flex-1">
                  Corrected these on Shopify? Re-check them all without leaving this report.
                </span>
                <button
                  onClick={() => retryAllFailed(retryableRows)}
                  disabled={retryBusy}
                  className="shrink-0 px-3 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {retryingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Retry all {retryableRows.length}
                </button>
              </div>
            )}

            <div className="rounded-xl border border-border divide-y divide-border max-h-72 overflow-y-auto">
              {[...report.results].sort((a, b) => (a.status === "failed" ? -1 : b.status === "failed" ? 1 : 0)).map(r => (
                <div key={r.orderId} className="flex items-start gap-3 px-3 py-2 text-sm flex-wrap">
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
                    {/* APC's own wording is left exactly as it came — it is
                        the authoritative text. This only says what to DO
                        about it, for the failures that are fixable on the
                        order (Graeme, 2026-09-03). */}
                    {r.status === "failed" && r.dataFixable && (
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        Correct this on the order in Shopify, then press Retry.
                      </span>
                    )}
                  </span>
                  {r.serviceCode && <span className="text-xs font-mono text-muted-foreground shrink-0">{r.serviceCode}</span>}

                  {/* Actions sit on their own full-width line rather than
                      squeezed onto the end of the row: at iPad width three
                      chips beside the reason left nothing tappable. */}
                  {(canRetry(r) || r.status === "failed") && (
                    <div className="w-full flex items-center justify-end gap-2 pt-1">
                      {/* The everyday path: the operator has just corrected
                          the order in Shopify. Re-reads it from Shopify, so
                          it books on the fix rather than the stale data. */}
                      {canRetry(r) && (
                        <button
                          onClick={() => retryRow(r)}
                          disabled={retryBusy}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-blue-400 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 inline-flex items-center gap-1 disabled:opacity-50"
                          title="Re-read this order from Shopify and try the booking again"
                        >
                          {retryingOrderId === r.orderId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                          Retry
                        </button>
                      )}
                      {/* Restricted routes (e.g. Isle of Wight) often accept
                          ND while refusing Lightweight. */}
                      {r.status === "failed" && r.suggestedRetryCode && (
                        <button
                          onClick={() => retryRow(r, r.suggestedRetryCode!)}
                          disabled={retryBusy}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-blue-400 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 inline-flex items-center gap-1 disabled:opacity-50"
                          title={`This route may not take ${r.usedServiceCode ?? "the chosen service"} — retry the booking on ${r.suggestedRetryCode}`}
                        >
                          <PackageCheck className="w-3.5 h-3.5" />
                          Retry as {r.suggestedRetryCode}
                        </button>
                      )}
                      {/* When the address is fine and the route simply can't
                          take the day, rescheduling is the resolution. One at
                          a time — each customer gets their own email. */}
                      {r.status === "failed" && (
                        <button
                          onClick={() => setRescheduling(r)}
                          disabled={retryBusy}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-amber-400 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 inline-flex items-center gap-1 disabled:opacity-50"
                          title="Move this order to a later delivery date and email the customer"
                        >
                          <CalendarClock className="w-3.5 h-3.5" /> Reschedule
                        </button>
                      )}
                      {r.adminUrl && (
                        <a
                          href={r.adminUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground inline-flex items-center gap-1"
                          title={`Open ${r.orderName} in Shopify to fix it`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Open in Shopify
                        </a>
                      )}
                    </div>
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
            // on twice. Counts are recomputed from the rows: this used to
            // change the row and leave the red "1 failed" tile standing over
            // it, so the two halves of the screen disagreed (Graeme,
            // 2026-09-03).
            setReport(prev => {
              if (!prev) return prev;
              const results = replaceRow(prev.results, rescheduling.orderId, {
                status: "skipped" as const,
                reason: "Rescheduled — moved off this dispatch day",
              });
              return { ...prev, results, ...countRows(results) };
            });
            onBooked();
          }}
        />
      )}
    </Dialog>
  );
}
