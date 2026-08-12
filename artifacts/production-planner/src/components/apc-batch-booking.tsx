/**
 * Book the day's APC consignments in one go, replacing the spreadsheet upload.
 *
 * The danger here is not booking — it's a partial run nobody notices, leaving
 * some orders without a label and no way to tell which. So the flow is:
 *
 *   1. PREFLIGHT   — nothing is booked. Shows what would be booked, what is
 *                    blocked, what needs a human look, what is already done.
 *   2. CONFIRM     — an explicit second step stating the exact count and that
 *                    real consignments will be raised.
 *   3. REPORT      — every order's individual outcome, failures first, kept
 *                    on screen until dismissed and copyable as text.
 *
 * Nothing is ever booked without the operator seeing stage 1 and 2.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, PackageCheck,
  Truck, ClipboardCopy, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  counts: { total: number; ready: number; needsReview: number; blocked: number; alreadyBooked: number; localDeliveries: number };
  ready: PreflightOrder[];
  needsReview: PreflightOrder[];
  blocked: PreflightOrder[];
  alreadyBooked: PreflightOrder[];
  localDeliveries: PreflightOrder[];
}

interface BookResult {
  orderId: number;
  orderName: string;
  status: "booked" | "skipped" | "failed";
  waybill?: string;
  serviceCode?: string;
  reference?: string;
  reason?: string;
  recordError?: string;
}

interface BookResponse {
  tag: string;
  booked: number;
  skipped: number;
  failed: number;
  recordErrors: number;
  results: BookResult[];
}

function OrderLine({ o, tone }: { o: PreflightOrder; tone: "ready" | "review" | "blocked" | "done" }) {
  return (
    <div className="flex items-start gap-3 py-1.5 text-sm border-b border-border/50 last:border-0">
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
    </div>
  );
}

function Section({ title, count, tone, orders, defaultOpen = false }: {
  title: string; count: number; tone: "ready" | "review" | "blocked" | "done"; orders: PreflightOrder[]; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  const toneClass = {
    ready: "border-green-300 dark:border-green-800 bg-green-50/60 dark:bg-green-950/20",
    review: "border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20",
    blocked: "border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20",
    done: "border-border bg-secondary/30",
  }[tone];
  return (
    <div className={cn("rounded-xl border overflow-hidden", toneClass)}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-sm font-semibold text-left">
        {tone === "ready" && <CheckCircle2 className="w-4 h-4 text-green-600" />}
        {tone === "review" && <AlertTriangle className="w-4 h-4 text-amber-600" />}
        {tone === "blocked" && <XCircle className="w-4 h-4 text-red-600" />}
        {tone === "done" && <PackageCheck className="w-4 h-4 text-muted-foreground" />}
        {title}
        <span className="ml-auto tabular-nums text-muted-foreground">{count}</span>
      </button>
      {open && <div className="px-3 pb-2 max-h-56 overflow-y-auto">{orders.map(o => <OrderLine key={o.orderId} o={o} tone={tone} />)}</div>}
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
  const [includeReviewed, setIncludeReviewed] = useState(false);
  const [stage, setStage] = useState<"review" | "confirm" | "booking" | "report">("review");
  const [report, setReport] = useState<BookResponse | null>(null);

  useState(() => {
    fetch(`${BASE}/api/fulfilment/batch-preflight?tag=${encodeURIComponent(tag)}`, { credentials: "include" })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Preflight failed");
        setPreflight(d);
      })
      .catch(e => setError(e instanceof Error ? e.message : "Preflight failed"))
      .finally(() => setLoading(false));
    return undefined;
  });

  const toBook = preflight
    ? [...preflight.ready, ...(includeReviewed ? preflight.needsReview : [])]
    : [];

  async function book() {
    if (!preflight || toBook.length === 0) return;
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

  return (
    <Dialog open onOpenChange={(v) => { if (!v && stage !== "booking") onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-primary" /> Book APC consignments — {tag}
          </DialogTitle>
          <DialogDescription>
            {stage === "report"
              ? "Every order's outcome is listed below. Anything that failed still has no label."
              : "Nothing is booked until you confirm. Check what's flagged first."}
          </DialogDescription>
        </DialogHeader>

        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="w-4 h-4 animate-spin" /> Checking the day's orders…</div>}

        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {/* ── Stage 1: review ── */}
        {preflight && stage === "review" && (
          <div className="space-y-3">
            {!preflight.codesConfigured && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2.5">
                <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>APC service codes aren't configured in Settings — nothing can be booked.</span>
              </div>
            )}

            <Section title="Ready to book" count={preflight.counts.ready} tone="ready" orders={preflight.ready} defaultOpen />
            <Section title="Needs a look before booking" count={preflight.counts.needsReview} tone="review" orders={preflight.needsReview} defaultOpen />
            <Section title="Can't be booked — fix in Shopify first" count={preflight.counts.blocked} tone="blocked" orders={preflight.blocked} defaultOpen />
            <Section title="Already booked" count={preflight.counts.alreadyBooked} tone="done" orders={preflight.alreadyBooked} />
            <Section title="Local delivery — no label needed" count={preflight.counts.localDeliveries} tone="done" orders={preflight.localDeliveries} />

            {preflight.counts.needsReview > 0 && (
              <label className="flex items-start gap-2 text-sm rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2.5 cursor-pointer">
                <input type="checkbox" checked={includeReviewed} onChange={e => setIncludeReviewed(e.target.checked)} className="mt-0.5" />
                <span>
                  Also book the <strong>{preflight.counts.needsReview}</strong> flagged for a look. Their addresses were reshaped
                  for the label — read the notes above before ticking this.
                </span>
              </label>
            )}

            <div className="flex items-center gap-3 pt-2 border-t border-border">
              <span className="text-sm text-muted-foreground">
                {toBook.length === 0 ? "Nothing to book" : <>Will book <strong className="text-foreground">{toBook.length}</strong> consignment{toBook.length !== 1 ? "s" : ""}</>}
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
            <span>Booking {toBook.length} consignments with APC — don't close this window…</span>
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
                  <span className="font-semibold w-[4.5rem] shrink-0">{r.orderName}</span>
                  <span className="flex-1 min-w-0">
                    {r.waybill && <span className="font-mono text-xs">{r.waybill}</span>}
                    {r.reference && r.reference !== r.orderName && (
                      <span className="text-xs text-muted-foreground"> · ref {r.reference}</span>
                    )}
                    {r.reason && <span className={cn("block text-xs", r.status === "failed" ? "text-destructive" : "text-muted-foreground")}>{r.reason}</span>}
                    {r.recordError && <span className="block text-xs text-red-600 font-semibold">NOT SAVED LOCALLY — write this number down</span>}
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
