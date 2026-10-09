/**
 * Booking issues today — almost full screen (Graeme, 2026-10-09).
 *
 * Today's failed APC bookings, read from the server's stored report, so it
 * can be closed to carry on packing and reopened from the packing screen at
 * any time today without booking anything again. Clears itself each day.
 *
 * Built so the wrong button can't be pressed on the wrong order:
 *   - one big card per order, in a fixed order that never changes — cards
 *     are updated in place, never re-sorted or removed;
 *   - every customer email, APC booking and escalation goes through a
 *     confirm sheet that names the order number and customer in big type;
 *   - buttons that make no sense for a case are off, with the reason shown.
 *
 * Closable by the X, Escape or the Close button; the panel is inset 8–16px,
 * capped at 96dvh, and scrolls inside.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ClipboardList, Loader2, RotateCcw, X, Mail, Megaphone } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { RescheduleOrderDialog } from "@/components/reschedule-order-dialog";
import { shortDay } from "@/lib/booking-issue-chips";
import { ConfirmSheet } from "./confirm-sheet";
import { IssueCard, type CardHandlers } from "./issue-card";
import {
  BOOKING_ISSUES_KEY, useBookingIssuesToday, useCantDeliverPreview, useDealtWith, useEscalateIssue,
  useRefundTick, useRetryIssues, useSendCantDeliverEmail, type BookingIssue,
} from "./api";

type Pending =
  | { kind: "email"; issue: BookingIssue }
  | { kind: "escalate"; issue: BookingIssue }
  | { kind: "retry"; issue: BookingIssue; code?: string }
  | { kind: "retryAll"; issues: BookingIssue[] };

function CantDeliverPreview({ id }: { id: number }) {
  const { data, isLoading, error } = useCantDeliverPreview(id);
  if (isLoading) return <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Preparing the email…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!data) return null;
  return (
    <div className="space-y-2">
      <p className="text-base"><span className="text-muted-foreground">To:</span> <span className="font-semibold">{data.to ?? "(no email address)"}</span></p>
      <p className="text-base"><span className="text-muted-foreground">Subject:</span> {data.subject}</p>
      <pre className="text-sm whitespace-pre-wrap font-sans bg-secondary/40 rounded-xl p-4">{data.body}</pre>
      <p className="text-sm text-muted-foreground">A copy goes to Graeme. The refund is NOT done by this — do it in Shopify and tick it on the card.</p>
    </div>
  );
}

export function BookingIssuesReport({ onClose, onChanged }: {
  onClose: () => void;
  /** Something changed an order (booked, moved) — the page refreshes its lists. */
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useBookingIssuesToday();
  const [pending, setPending] = useState<Pending | null>(null);
  const [rescheduling, setRescheduling] = useState<BookingIssue | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const sendEmail = useSendCantDeliverEmail();
  const escalate = useEscalateIssue();
  const refund = useRefundTick();
  const dealtWith = useDealtWith();
  const retry = useRetryIssues();

  // The page behind stays put while this is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !pending && !rescheduling) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, rescheduling, onClose]);

  const fail = (title: string) => (e: unknown) =>
    toast({ title, description: e instanceof Error ? e.message : String(e), variant: "destructive" });

  const handlers: CardHandlers = {
    busyId,
    onRetry: (issue, code) => setPending({ kind: "retry", issue, code }),
    onReschedule: issue => setRescheduling(issue),
    onEmail: issue => setPending({ kind: "email", issue }),
    onEscalate: issue => { setNote(""); setPending({ kind: "escalate", issue }); },
    onRefund: (issue, done) => {
      setBusyId(issue.id);
      refund.mutate({ id: issue.id, done }, {
        onSuccess: () => toast({ title: done ? `${issue.orderName}: refund recorded as done` : `${issue.orderName}: refund tick removed` }),
        onError: fail("Couldn't record the refund"),
        onSettled: () => setBusyId(null),
      });
    },
    onDealtWith: (issue, done) => {
      setBusyId(issue.id);
      dealtWith.mutate({ id: issue.id, done }, {
        onSuccess: () => toast({ title: done ? `${issue.orderName} marked dealt with` : `${issue.orderName} reopened` }),
        onError: fail("Couldn't update the card"),
        onSettled: () => setBusyId(null),
      });
    },
  };

  async function runRetry(issues: BookingIssue[], code?: string) {
    // One call per dispatch day — usually just one.
    const byTag = new Map<string, BookingIssue[]>();
    for (const i of issues) byTag.set(i.dispatchTag, [...(byTag.get(i.dispatchTag) ?? []), i]);
    let booked = 0; let failed = 0;
    for (const [tag, list] of byTag) {
      const r = await retry.mutateAsync({ tag, orderIds: list.map(i => i.orderId), code });
      booked += r.results.filter(x => x.status === "booked").length;
      failed += r.results.filter(x => x.status === "failed").length;
      if (issues.length === 1) {
        const one = r.results[0];
        toast({
          title: one?.status === "booked" ? `${issues[0].orderName} booked${code ? ` on ${code}` : ""}` : `${issues[0].orderName} — ${one?.status === "failed" ? "still failing" : one?.reason ?? "skipped"}`,
          description: one?.status === "failed" ? one.reason : undefined,
          variant: one?.status === "failed" ? "destructive" : undefined,
        });
      }
    }
    if (issues.length > 1) {
      toast({ title: failed === 0 ? `All ${booked} booked` : `${booked} booked · ${failed} still failing`, variant: failed > 0 ? "destructive" : undefined });
    }
    if (booked > 0) onChanged?.();
  }

  function confirmPending() {
    if (!pending) return;
    if (pending.kind === "email") {
      const { issue } = pending;
      sendEmail.mutate({ id: issue.id, confirmOrderName: issue.orderName }, {
        onSuccess: r => { toast({ title: `Email sent to ${r.to}`, description: issue.orderName }); setPending(null); },
        onError: fail("Email not sent"),
      });
    } else if (pending.kind === "escalate") {
      const { issue } = pending;
      escalate.mutate({ id: issue.id, note: note.trim() || undefined }, {
        onSuccess: r => { toast({ title: `${issue.orderName} escalated`, description: `Sent to ${r.to.join(", ")}` }); setPending(null); },
        onError: fail("Not escalated"),
      });
    } else {
      const list = pending.kind === "retry" ? [pending.issue] : pending.issues;
      const code = pending.kind === "retry" ? pending.code : undefined;
      if (pending.kind === "retry") setBusyId(pending.issue.id);
      runRetry(list, code)
        .then(() => setPending(null))
        .catch(fail("Retry failed"))
        .finally(() => setBusyId(null));
    }
  }

  const issues = data?.issues ?? [];
  // "Retry all" is for the fixable ones — never a postcode APC can't reach.
  const retryable = issues.filter(i => i.actions.retry.enabled && !i.done && i.scenario !== "cant_deliver");
  const confirmBusy = sendEmail.isPending || escalate.isPending || retry.isPending;

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-stretch justify-center p-2 sm:p-4 pointer-events-auto">
      <div role="dialog" aria-modal="true" aria-label="Booking issues today"
        className="bg-background rounded-3xl border-2 border-border shadow-2xl w-full max-w-[1400px] max-h-[96dvh] flex flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-6 py-3 sm:py-4 border-b border-border">
          <ClipboardList className="w-7 h-7 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="text-xl sm:text-2xl font-black leading-tight">Booking issues today</h2>
            <p className="text-sm text-muted-foreground hidden sm:block">
              {data ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${data.date}T12:00:00Z`)) : "…"}
              {" · "}saved, so you can close this and come back — clears tomorrow
            </p>
          </div>
          {/* Counts and Retry all drop to their own row on a phone; the X
              always stays top right. */}
          <div className="order-last sm:order-none w-full sm:w-auto flex flex-wrap items-center gap-2">
            {data && (
              <>
                <span className="px-3 py-1.5 rounded-full bg-red-100 dark:bg-red-950/50 text-red-900 dark:text-red-100 tabular-nums text-base font-bold">{data.open} open</span>
                <span className="px-3 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-100 tabular-nums text-base font-bold">{data.total - data.open} done</span>
              </>
            )}
            {data?.canCourier && retryable.length > 1 && (
              <button onClick={() => setPending({ kind: "retryAll", issues: retryable })} disabled={retry.isPending}
                className="h-11 sm:h-12 px-4 rounded-xl border-2 border-blue-400 dark:border-blue-700 text-blue-800 dark:text-blue-200 text-base font-semibold inline-flex items-center gap-2 hover:bg-blue-50 dark:hover:bg-blue-950/30 disabled:opacity-45">
                <RotateCcw className="w-5 h-5" /> Retry all {retryable.length}
              </button>
            )}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="h-12 w-12 shrink-0 rounded-xl border-2 border-border flex items-center justify-center hover:bg-secondary/60">
            <X className="w-6 h-6" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4" style={{ overflowAnchor: "auto" }}>
          {isLoading && <p className="flex items-center gap-2 text-lg text-muted-foreground py-10 justify-center"><Loader2 className="w-6 h-6 animate-spin" /> Loading today's issues…</p>}
          {error && (
            <p className="flex items-start gap-2 text-base text-destructive bg-destructive/10 rounded-2xl px-4 py-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /> {(error as Error).message}
            </p>
          )}
          {data && issues.length === 0 && (
            <p className="text-lg text-muted-foreground text-center py-16">No booking issues today. Every order booked.</p>
          )}
          {/* Fixed order (first failure, then id) from the server — never
              re-sorted here, so a card never moves under a finger. */}
          <div className="grid gap-4 lg:grid-cols-2 items-start">
            {issues.map(issue => <IssueCard key={issue.id} issue={issue} h={handlers} />)}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-t border-border">
          <p className="text-sm text-muted-foreground hidden sm:block">Booked orders drop to "Done" here automatically. Nothing on this screen books with APC unless you press Retry and confirm.</p>
          <button onClick={onClose} className="h-12 px-6 rounded-xl bg-primary text-primary-foreground text-base font-bold hover:bg-primary/90 ml-auto">Close</button>
        </footer>
      </div>

      {pending?.kind === "email" && (
        <ConfirmSheet title="Send the “can't deliver” email to" orderName={pending.issue.orderName} customerName={pending.issue.customerName}
          confirmLabel={`Send to ${pending.issue.customerName?.split(/\s+/)[0] ?? "the customer"}`} tone="danger"
          onConfirm={confirmPending} onClose={() => setPending(null)} busy={sendEmail.isPending}>
          <p className="text-base flex items-center gap-2 font-semibold"><Mail className="w-5 h-5" /> Exactly what the customer will receive:</p>
          <CantDeliverPreview id={pending.issue.id} />
        </ConfirmSheet>
      )}

      {pending?.kind === "escalate" && (
        <ConfirmSheet title="Escalate to a manager" orderName={pending.issue.orderName} customerName={pending.issue.customerName}
          confirmLabel="Send to the managers" tone="primary" onConfirm={confirmPending} onClose={() => setPending(null)} busy={escalate.isPending}
          confirmDisabled={(data?.escalateTo.length ?? 0) === 0}>
          <p className="text-base flex items-start gap-2"><Megaphone className="w-5 h-5 shrink-0 mt-0.5 text-violet-600" />
            <span>A team message goes to <strong>{data?.escalateTo.length ? data.escalateTo.join(", ") : "no other manager"}</strong>, who must confirm they've seen it. It says what happened to {pending.issue.orderName} and why.</span>
          </p>
          <p className="text-base rounded-xl bg-secondary/40 px-3 py-2"><strong>{pending.issue.wording.title}.</strong> {pending.issue.wording.explain}</p>
          <label className="block text-sm font-semibold">Anything to add? (optional)
            <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={3}
              placeholder="e.g. customer phoned, APC said they'll call back"
              className="mt-1 w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-base font-normal" />
          </label>
        </ConfirmSheet>
      )}

      {pending?.kind === "retry" && (
        <ConfirmSheet title={`Book again with APC${pending.code ? ` on ${pending.code}` : ""}`} orderName={pending.issue.orderName} customerName={pending.issue.customerName}
          confirmLabel={`Yes — book ${pending.issue.orderName}`} tone="danger" onConfirm={confirmPending} onClose={() => setPending(null)} busy={retry.isPending}>
          <p className="text-base">This raises a real, chargeable consignment with APC for delivery {shortDay(pending.issue.dispatchTag)}. The order is re-read from Shopify first, so any fix you made there is used, and APC is asked whether it already holds one — nothing is booked twice.</p>
        </ConfirmSheet>
      )}

      {pending?.kind === "retryAll" && (
        <ConfirmSheet title={`Book ${pending.issues.length} orders again with APC`} orderName={pending.issues.map(i => i.orderName).join(", ")} customerName={null}
          confirmLabel={`Yes — book all ${pending.issues.length}`} tone="danger" onConfirm={confirmPending} onClose={() => setPending(null)} busy={retry.isPending}>
          <ul className="text-base space-y-1">
            {pending.issues.map(i => <li key={i.id}><strong>{i.orderName}</strong> — {i.customerName ?? "—"} · {i.postcode ?? ""}</li>)}
          </ul>
          <p className="text-base">Real, chargeable consignments. Orders that APC refused for a postcode reason will most likely fail again.</p>
        </ConfirmSheet>
      )}

      {/* The reschedule pop-up is its own confirm step: it shows the order,
          the customer, every change to the Shopify order and the email
          word for word before anything is written or sent. */}
      {rescheduling && (
        <RescheduleOrderDialog
          orderId={rescheduling.orderId}
          orderName={rescheduling.orderName}
          fromDate={rescheduling.dispatchTag}
          adminUrl={rescheduling.adminUrl ?? undefined}
          weekdaysOnly={rescheduling.actions.reschedule.weekdaysOnly}
          defaultSendEmail={rescheduling.actions.reschedule.defaultSendEmail}
          onClose={() => setRescheduling(null)}
          onDone={() => { void qc.invalidateQueries({ queryKey: BOOKING_ISSUES_KEY }); onChanged?.(); }}
        />
      )}
    </div>,
    document.body,
  );
}
