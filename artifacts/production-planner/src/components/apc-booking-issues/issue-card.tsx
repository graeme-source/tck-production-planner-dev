/**
 * One failed booking, as a big card: who and where, what went wrong in plain
 * words, APC's two postcode lines, and ONLY the buttons that make sense for
 * this case (the server decides which — lib/apc-booking-issues.ts). A button
 * that is off says why underneath, rather than vanishing.
 *
 * The card never moves or disappears when something is done to it: its
 * chips and the band at the top change in place ("To do" → "Done").
 */
import type { ReactNode } from "react";
import {
  AlertTriangle, Ban, CalendarClock, CalendarX, CheckCircle2, Clock, ExternalLink, Mail,
  PackageCheck, RotateCcw, Undo2, Loader2, Receipt, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PostcodeServiceCard } from "@/components/apc-postcode-service";
import { issueChips, issueWarnings, shortDay } from "@/lib/booking-issue-chips";
import type { Availability, BookingIssue, IssueScenario } from "./api";

const SCENARIO_STYLE: Record<IssueScenario, { ring: string; band: string; icon: ReactNode }> = {
  cant_deliver: {
    ring: "border-red-400 dark:border-red-700",
    band: "bg-red-50 dark:bg-red-950/40 text-red-950 dark:text-red-100",
    icon: <Ban className="w-6 h-6 text-red-600 shrink-0" />,
  },
  saturday_permanent: {
    ring: "border-amber-400 dark:border-amber-700",
    band: "bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100",
    icon: <CalendarX className="w-6 h-6 text-amber-600 shrink-0" />,
  },
  saturday_temporary: {
    ring: "border-blue-400 dark:border-blue-700",
    band: "bg-blue-50 dark:bg-blue-950/40 text-blue-950 dark:text-blue-100",
    icon: <Clock className="w-6 h-6 text-blue-600 shrink-0" />,
  },
  other: {
    ring: "border-slate-300 dark:border-slate-700",
    band: "bg-slate-50 dark:bg-slate-900/50 text-slate-950 dark:text-slate-100",
    icon: <AlertTriangle className="w-6 h-6 text-slate-600 shrink-0" />,
  },
};

function time(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(iso));
}

function BigAction({ a, onClick, icon, label, tone = "neutral", busy }: {
  a: Availability; onClick: () => void; icon: ReactNode; label: string;
  tone?: "neutral" | "blue" | "amber" | "red" | "violet"; busy?: boolean;
}) {
  if (!a.show) return null;
  const tones = {
    neutral: "border-border hover:bg-secondary/60",
    blue: "border-blue-400 dark:border-blue-700 text-blue-800 dark:text-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950/30",
    amber: "border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/30",
    red: "border-red-400 dark:border-red-700 text-red-800 dark:text-red-200 hover:bg-red-50 dark:hover:bg-red-950/30",
    violet: "border-violet-400 dark:border-violet-700 text-violet-800 dark:text-violet-200 hover:bg-violet-50 dark:hover:bg-violet-950/30",
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={!a.enabled || busy}
      title={a.reason}
      className={cn(
        "min-h-12 px-4 py-2 rounded-xl border-2 bg-background text-base font-semibold inline-flex items-center justify-center gap-2 transition-colors",
        "disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-background",
        tones,
      )}
    >
      {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

export interface CardHandlers {
  onRetry: (issue: BookingIssue, code?: string) => void;
  onReschedule: (issue: BookingIssue) => void;
  onEmail: (issue: BookingIssue) => void;
  onEscalate: (issue: BookingIssue) => void;
  onRefund: (issue: BookingIssue, done: boolean) => void;
  onDealtWith: (issue: BookingIssue, done: boolean) => void;
  busyId: number | null;
}

/** `bare`: the inside of an opened row — no outer card, band or big header
 *  (the row above already says who, where and what). */
export function IssueCard({ issue, h, bare = false }: { issue: BookingIssue; h: CardHandlers; bare?: boolean }) {
  const style = SCENARIO_STYLE[issue.scenario];
  const a = issue.actions;
  const chips = issueChips(issue);
  const busy = h.busyId === issue.id;
  const reasons = [
    a.retry.show && !a.retry.enabled && a.retry.reason ? `Retry: ${a.retry.reason}` : null,
    a.reschedule.show && !a.reschedule.enabled && a.reschedule.reason ? `Reschedule: ${a.reschedule.reason}` : null,
    a.emailCantDeliver.show && !a.emailCantDeliver.enabled && a.emailCantDeliver.reason ? `Email: ${a.emailCantDeliver.reason}` : null,
  ].filter((x): x is string => !!x);
  const anyAction = [a.retry, a.retryAs, a.reschedule, a.emailCantDeliver, a.refund, a.dealtWith].some(x => x.show);

  return (
    <article className={cn(bare ? "flex flex-col" : "rounded-3xl border-2 bg-card shadow-sm overflow-hidden flex flex-col", !bare && (issue.done ? "border-emerald-400 dark:border-emerald-700" : style.ring))}>
      {/* Band: what's left to do, or that it's finished. Same place, same
          size either way, so finishing a card doesn't shift the screen. */}
      {bare ? null : issue.done ? (
        <div className="flex items-start gap-3 px-5 py-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">Done</p>
            <p className="text-sm mt-0.5">{issue.wording.title} — nothing more to do on this order.</p>
          </div>
        </div>
      ) : (
        <div className={cn("flex items-start gap-3 px-5 py-3", style.band)}>
          {style.icon}
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">{issue.wording.title}</p>
            <p className="text-sm mt-0.5">{issue.wording.explain}</p>
          </div>
        </div>
      )}

      <div className={cn(bare ? "px-4 sm:px-5 py-4 space-y-3 flex-1" : "p-5 space-y-4 flex-1", issue.done && !bare && "opacity-75")}>
        {bare && (
          <p className="text-sm text-muted-foreground">
            {issue.wording.explain}
            {issue.adminUrl && (
              <> · <a href={issue.adminUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline inline-flex items-center gap-1">
                Open {issue.orderName} in Shopify <ExternalLink className="w-3.5 h-3.5" />
              </a></>
            )}
          </p>
        )}
        {/* Who and where — the order number is the way into Shopify. */}
        {!bare && <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
          {issue.adminUrl ? (
            <a href={issue.adminUrl} target="_blank" rel="noopener noreferrer"
              className="text-3xl font-black tabular-nums text-primary hover:underline inline-flex items-center gap-1.5"
              title={`Open ${issue.orderName} in Shopify`}>
              {issue.orderName} <ExternalLink className="w-5 h-5" />
            </a>
          ) : <span className="text-3xl font-black tabular-nums">{issue.orderName}</span>}
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-tight truncate">{issue.customerName ?? "—"}</p>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono font-semibold text-foreground">{issue.postcode ?? "no postcode"}</span>
              {" · "}for delivery {shortDay(issue.dispatchTag)}
              {issue.usedServiceCode ? <> · <span className="font-mono">{issue.usedServiceCode}</span></> : null}
            </p>
          </div>
        </div>}

        {!bare && chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map(c => (
              <span key={c.key} className={cn(
                "px-3 py-1 rounded-full text-sm font-semibold border",
                c.tone === "done" && "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100",
                c.tone === "info" && "bg-violet-50 dark:bg-violet-950/40 border-violet-300 dark:border-violet-800 text-violet-900 dark:text-violet-100",
                c.tone === "warn" && "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-900 dark:text-red-100",
              )}>{c.label}</span>
            ))}
          </div>
        )}

        {!issue.done && !bare && (
          <p className="text-base font-semibold flex items-start gap-2">
            <span className="shrink-0 px-2 py-0.5 rounded-md bg-foreground text-background text-xs font-bold uppercase tracking-wide mt-0.5">To do</span>
            <span>{issue.wording.whatToDo}</span>
          </p>
        )}

        {issue.reason && (
          <p className="text-sm rounded-xl bg-secondary/50 px-3 py-2">
            <span className="font-semibold">APC said:</span> <span className="font-mono">{issue.reason}</span>
          </p>
        )}

        {/* APC's two postcode lines — next-day weekday and Saturday, from
            APC's postcode table with recorded APC answers applied. */}
        {issue.postcodeService ? (
          <PostcodeServiceCard
            service={issue.postcodeService}
            advice={issue.done || issue.scenario === "cant_deliver" ? null : issue.postcodeAdvice?.text}
            call={issue.done ? null : issue.postcodeAdvice?.call}
            callService={issue.postcodeAdvice?.service}
          />
        ) : issue.postcodeCheck ? (
          <p className="text-sm rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">{issue.postcodeCheck}</p>
        ) : null}

        {issue.scenario === "cant_deliver" && !issue.resolvedAt && (
          <div className="rounded-2xl border-2 border-red-300 dark:border-red-800 p-4 space-y-3">
            <p className="text-base font-bold flex items-center gap-2"><Receipt className="w-5 h-5 text-red-600" /> Refund needed — do it in Shopify</p>
            <p className="text-sm text-muted-foreground">The app doesn't refund orders. Open the order in Shopify, refund it in full, then tick here.</p>
            <div className="flex flex-wrap gap-3">
              {issue.adminUrl && (
                <a href={issue.adminUrl} target="_blank" rel="noopener noreferrer"
                  className="min-h-12 px-4 py-2 rounded-xl border-2 border-border bg-background text-base font-semibold inline-flex items-center gap-2 hover:bg-secondary/60">
                  <ExternalLink className="w-5 h-5" /> Open {issue.orderName} in Shopify
                </a>
              )}
              {a.refund.show && (
                <label className={cn(
                  "min-h-12 px-4 py-2 rounded-xl border-2 text-base font-semibold inline-flex items-center gap-3 select-none",
                  a.refund.enabled ? "cursor-pointer" : "opacity-45 cursor-not-allowed",
                  issue.state.refundDone ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30" : "border-border bg-background",
                )} title={a.refund.reason}>
                  <input type="checkbox" className="w-6 h-6" checked={issue.state.refundDone} disabled={!a.refund.enabled || busy}
                    onChange={e => h.onRefund(issue, e.target.checked)} />
                  Refund done in Shopify{issue.state.refundDone && issue.state.refundDoneBy ? ` (${issue.state.refundDoneBy})` : ""}
                </label>
              )}
            </div>
          </div>
        )}

        {anyAction && (
          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap gap-2.5">
              {issue.scenario === "cant_deliver" && (
                <>
                  <BigAction a={a.emailCantDeliver} onClick={() => h.onEmail(issue)} icon={<Mail className="w-5 h-5" />} label="Send “can't deliver” email" tone="red" />
                </>
              )}
              <BigAction a={a.reschedule} onClick={() => h.onReschedule(issue)} icon={<CalendarClock className="w-5 h-5" />}
                label={a.reschedule.weekdaysOnly ? "Reschedule to a weekday" : "Reschedule"} tone="amber" />
              <BigAction a={a.retry} onClick={() => h.onRetry(issue)} icon={<RotateCcw className="w-5 h-5" />}
                label={issue.scenario === "cant_deliver" ? "Postcode corrected? Retry" : "Retry"} tone="blue" busy={busy} />
              {a.retryAs.code && (
                <BigAction a={a.retryAs} onClick={() => h.onRetry(issue, a.retryAs.code)} icon={<PackageCheck className="w-5 h-5" />} label={`Retry as ${a.retryAs.code}`} tone="blue" />
              )}
              {/* No "Escalate to a manager" here any more (27 Nov 2026):
                  managers work this report; the team sends issues on with
                  "Send to a manager and carry on packing". */}
              <BigAction a={a.dealtWith} onClick={() => h.onDealtWith(issue, !issue.dealtWithAt)}
                icon={issue.dealtWithAt ? <Undo2 className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                label={issue.dealtWithAt ? "Reopen" : "Mark dealt with"} />
            </div>
            {reasons.length > 0 && (
              <ul className="text-sm text-muted-foreground space-y-0.5">
                {reasons.map(r => <li key={r} className="flex gap-1.5"><span aria-hidden>•</span><span>{r}</span></li>)}
              </ul>
            )}
            {!issue.done && a.dealtWith.show && !a.dealtWith.enabled && a.dealtWith.reason && (
              <p className="text-sm text-muted-foreground">{a.dealtWith.reason}</p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Failed {issue.attempts > 1 ? `${issue.attempts} times, last at ${time(issue.lastFailedAt)}` : `at ${time(issue.firstFailedAt)}`}
          {issue.firstFailedBy ? ` · booked by ${issue.firstFailedBy}` : ""}
          {issue.resolvedAt ? ` · booked at ${time(issue.resolvedAt)}` : ""}
        </p>
      </div>
    </article>
  );
}

const CHIP_TONE: Record<string, string> = {
  done: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100",
  info: "bg-violet-50 dark:bg-violet-950/40 border-violet-300 dark:border-violet-800 text-violet-900 dark:text-violet-100",
  warn: "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-900 dark:text-red-100",
};

/**
 * One order as a full-width row (Graeme, 27 Nov 2026: "see 10 at once"):
 * status, order, customer, postcode, delivery day, what's wrong / what to
 * do, its progress chips and any warning — tap to open the full card with
 * every button. A row never moves while the report is open.
 */
export function IssueRow({ issue, h, open, onToggle }: { issue: BookingIssue; h: CardHandlers; open: boolean; onToggle: () => void }) {
  const style = SCENARIO_STYLE[issue.scenario];
  const chips = issueChips(issue).filter(c => !(c.key === "escalated" || c.key === "refund"));
  const warnings = issueWarnings(issue);
  const a = issue.actions;
  const showReschedule = !issue.done && a.reschedule.show;
  const pills = [
    ...warnings.map(w => (
      <span key={`w-${w.key}`} className={cn("px-2 py-0.5 rounded-full text-xs font-bold border inline-flex items-center gap-1", CHIP_TONE[w.tone])}>
        {w.tone === "warn" && <AlertTriangle className="w-3 h-3" />}{w.label}
      </span>
    )),
    ...chips.map(c => (
      <span key={`c-${c.key}`} className={cn("px-2 py-0.5 rounded-full text-xs font-semibold border", CHIP_TONE[c.tone])}>{c.label}</span>
    )),
  ];
  return (
    <div className={cn("rounded-2xl border-2 bg-card overflow-hidden", issue.done ? "border-border" : style.ring, open && "shadow-md")}>
      <div className={cn("flex items-center", issue.done && !open && "opacity-70")}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex-1 min-w-0 text-left pl-3 sm:pl-4 pr-2 py-2.5 min-h-14 flex items-center gap-2 sm:gap-3 hover:bg-secondary/40">
        <span className="shrink-0">
          {issue.done ? <CheckCircle2 className="w-6 h-6 text-emerald-600" /> : style.icon}
        </span>
        <span className="w-[4.75rem] sm:w-[5.5rem] shrink-0 text-base sm:text-lg font-black tabular-nums">{issue.orderName}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base">
            <span className="font-semibold">{issue.customerName ?? "—"}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="font-mono font-semibold">{issue.postcode ?? "no postcode"}</span>
            <span className="text-muted-foreground"> · {shortDay(issue.dispatchTag)}</span>
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {issue.done ? `Done — ${issue.wording.title}` : <><span className="font-semibold text-foreground">{issue.wording.title}</span> — {issue.wording.whatToDo}</>}
          </span>
          {/* Phone: chips under the text. */}
          {pills.length > 0 && <span className="md:hidden flex flex-wrap gap-1.5 mt-1">{pills}</span>}
        </span>
        {pills.length > 0 && <span className="hidden md:flex flex-wrap gap-1.5 justify-end max-w-[45%]">{pills}</span>}
      </button>
      {/* Reschedule straight from the row (27 Nov 2026) — the same pop-up
          as inside, which shows the Shopify change and email first. */}
      {showReschedule && (
        <button type="button" onClick={() => h.onReschedule(issue)} disabled={!a.reschedule.enabled} title={a.reschedule.reason}
          className="shrink-0 h-11 px-3 rounded-xl border-2 border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 bg-background text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:opacity-45 disabled:cursor-not-allowed">
          <CalendarClock className="w-4 h-4" /> <span className="hidden sm:inline">Reschedule</span>
        </button>
      )}
      <button type="button" onClick={onToggle} aria-label={open ? "Close" : "Open"} className="shrink-0 h-14 w-11 sm:w-12 flex items-center justify-center hover:bg-secondary/40">
        <ChevronDown className={cn("w-5 h-5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      </div>
      {open && (
        <div className="border-t border-border">
          <IssueCard issue={issue} h={h} bare />
        </div>
      )}
    </div>
  );
}
