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
 *   3. REPORT    — the counts and every order's outcome, copyable. Any
 *                  failure is dealt with in the near-full-screen "Booking
 *                  issues today" report (components/apc-booking-issues),
 *                  which is saved server-side and can be reopened from the
 *                  packing screen all day without booking again.
 *
 * Nothing is booked without the operator seeing stages 1 and 2.
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, PackageCheck,
  Truck, ClipboardCopy, ShieldAlert, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import type { PostcodeServiceFacts, PostcodeCall } from "@/components/apc-postcode-service";
import { BOOKING_ISSUES_KEY } from "@/components/apc-booking-issues/api";

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
  /** What APC's POSTINFO postcode sheet says this postcode can take — the
   *  spreadsheet check, done server-side, that drives the reschedule call. */
  postcodeCheck?: string;
  /** The same check as separate facts, for the two ticked lines. */
  postcodeService?: PostcodeServiceFacts;
  /** What to do about a coverage refusal: call APC (the table says the
   *  depot normally offers it), or reschedule (APC's answer is on record). */
  postcodeAdvice?: string;
  postcodeAdviceKind?: "call_depot" | "reschedule_confirmed" | "reschedule_temporary";
  postcodeAdviceService?: "saturday" | "weekday";
  /** Present with call_depot: who to call and the outward code/depot the
   *  recorded answer applies to. */
  postcodeCall?: PostcodeCall;
}

interface BookResponse {
  tag: string;
  /** False when the server couldn't save the failures to today's issues
   *  report — the list below is then the only record. */
  issuesSaved?: boolean;
  booked: number;
  skipped: number;
  failed: number;
  recordErrors: number;
  results: BookResult[];
}

type Tone = "ready" | "review" | "blocked" | "done";

function OrderLine({ o, tone, adminBase, selectable, checked, onToggle }: {
  o: PreflightOrder; tone: Tone; adminBase?: string; selectable?: boolean; checked?: boolean; onToggle?: () => void;
}) {
  const body = (
    <>
      {/* The order number is the way into Shopify, on this stage as much as
          on the report: the orders flagged here are the ones whose shipping
          address has to be opened and corrected BEFORE booking. It was a
          link only after booking, so a fix meant hunting the order by hand
          (Graeme, 2026-09-04). stopPropagation keeps the tap off the row's
          tick — the label would otherwise toggle the checkbox too. */}
      {adminBase ? (
        <a
          href={`${adminBase}${o.orderId}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="font-semibold w-[4.5rem] shrink-0 text-primary hover:underline"
          title={`Open ${o.orderName} in Shopify`}
        >
          {o.orderName}
        </a>
      ) : (
        <span className="font-semibold w-[4.5rem] shrink-0">{o.orderName}</span>
      )}
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

function Section({ title, count, tone, orders, adminBase, defaultOpen = false, selectable, selected, onToggle }: {
  title: string; count: number; tone: Tone; orders: PreflightOrder[]; adminBase?: string; defaultOpen?: boolean;
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
              adminBase={adminBase}
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

export function ApcBatchBookingDialog({ tag, adminBase, onClose, onBooked, onOpenIssues }: {
  tag: string;
  /** Shopify admin `/admin/orders/` prefix, from the config status. Handed in
   *  rather than built here so the store domain stays server-side. */
  adminBase?: string;
  onClose: () => void;
  onBooked: () => void;
  /** Close this and open the big "Booking issues today" report. */
  onOpenIssues: () => void;
}) {
  const qc = useQueryClient();
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"review" | "confirm" | "booking" | "report">("review");
  const [report, setReport] = useState<BookResponse | null>(null);
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
      void qc.invalidateQueries({ queryKey: BOOKING_ISSUES_KEY });
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
    <Dialog open onOpenChange={(v) => { if (!v && stage !== "booking") onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-primary" /> Book APC consignments — {tag}
          </DialogTitle>
          <DialogDescription>
            {stage === "report"
              ? "Every order's outcome is listed below. Anything that failed still has no label — deal with it in the issues report."
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

            <Section title="Ready to book" count={preflight.counts.ready} tone="ready" orders={preflight.ready} adminBase={adminBase} defaultOpen
              selectable selected={selected} onToggle={toggle} />
            <Section title="Needs a look before booking" count={preflight.counts.needsReview} tone="review" orders={preflight.needsReview} adminBase={adminBase} defaultOpen
              selectable selected={selected} onToggle={toggle} />
            <Section title="Can't be booked — fix in Shopify first" count={preflight.counts.blocked} tone="blocked" orders={preflight.blocked} adminBase={adminBase} defaultOpen />
            <Section title="Not tagged for dispatch — tag before booking" count={preflight.counts.notTagged ?? 0} tone="blocked" orders={preflight.notTagged ?? []} adminBase={adminBase} />
            <Section title="Already booked" count={preflight.counts.alreadyBooked} tone="done" orders={preflight.alreadyBooked} adminBase={adminBase} />
            <Section title="Local delivery — no label needed" count={preflight.counts.localDeliveries} tone="done" orders={preflight.localDeliveries} adminBase={adminBase} />
            <Section title="Collection — brown paper bag, never APC" count={preflight.counts.collections ?? 0} tone="done" orders={preflight.collections ?? []} adminBase={adminBase} />

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

            {/* Failures are worked in the big, saved report — not in this
                small dialog (Graeme, 2026-10-09). */}
            {report.failed > 0 && report.issuesSaved !== false && (
              <button
                onClick={onOpenIssues}
                className="w-full min-h-16 rounded-2xl bg-red-600 hover:bg-red-700 text-white px-4 py-3 text-left flex items-center gap-3"
              >
                <ClipboardList className="w-7 h-7 shrink-0" />
                <span className="flex-1">
                  <span className="block text-lg font-bold">Deal with the {report.failed} order{report.failed !== 1 ? "s" : ""} that didn't book</span>
                  <span className="block text-sm text-white/90">Opens today's booking issues report — saved, so you can close it and carry on packing.</span>
                </span>
              </button>
            )}
            {report.issuesSaved === false && (
              <div className="flex items-start gap-2 text-sm rounded-xl border-2 border-red-400 bg-red-50 dark:bg-red-950/30 px-3 py-2.5">
                <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-600" />
                <span className="text-red-900 dark:text-red-200">
                  <strong>These failures couldn't be saved to today's issues report.</strong> Press Copy report before closing — this list is the only record.
                </span>
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
                  </span>
                  {r.serviceCode && <span className="text-xs font-mono text-muted-foreground shrink-0">{r.serviceCode}</span>}

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

    </Dialog>
  );
}
