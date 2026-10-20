/**
 * The marketing calendar on the Sales & Marketing page — stripped back
 * (Graeme, 2026-10-20): "In the calendar we'll just have PHASES, easy to
 * edit … We just want to see what emails are drafted in Klaviyo and
 * scheduled for which dates, with ONE approval status." Objective I.
 *
 *   - PHASES: dated periods of any length, with optional offers (picked from
 *     the offer library or typed new), customer group and notes. Drag to
 *     move or stretch, tap to edit everything, tap an empty day to add one,
 *     or "Re-use a past phase".
 *   - KLAVIYO EMAILS: drafts, scheduled and sent, read from Klaviyo on their
 *     send days (drafts with no date listed on their own). Each is Approved
 *     or Needs approval; approvers approve with one tap. Emails are only
 *     ever built in Klaviyo.
 *   - OFFERS: the list of offers, managed from the "Offers" button.
 *
 * Planned emails, the weekly offer cycle, notes and to-dos are no longer on
 * the calendar (their data stays in the database).
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle, BadgeCheck, ChevronLeft, ChevronRight, Copy, Loader2, Lock, Mail, Megaphone, Package, PencilLine, Plus, ShieldAlert, Sparkles, Tag, Users, X,
} from "lucide-react";
import {
  addDays, addMonths, customerGroupChip, formatRange, monthGridWeeks, monthStart, overlaps, type DragMode,
} from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import {
  calApi, useApprovalsNeeded, useCalendarEmails, useCreatePhase, usePhases, useSetPhaseDates,
  type CalEmail, type Phase, type Suggestion,
} from "./api";
import { KLAVIYO_TONE, PHASE_TONE, emailStatusLabel } from "./constants";
import { MonthGrid } from "./month-grid";
import { PhaseModal } from "./phase-modal";
import { EmailPanel, ApprovalBadge, ApproveButton, sendLine } from "./email-panel";
import { OffersManager } from "./offers-manager";
import { ReusePhase } from "./reuse-phase";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

export function MarketingCalendar() {
  const localToday = londonToday();
  const [anchor, setAnchor] = useState(() => monthStart(localToday));
  const [open, setOpen] = useState<{ id: number | null; newOn?: string; key: number } | null>(null);
  const [openEmail, setOpenEmail] = useState<CalEmail | null>(null);
  const [offersOpen, setOffersOpen] = useState(false);
  const [reuseOpen, setReuseOpen] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);

  const range = useMemo(() => {
    const weeks = monthGridWeeks(anchor);
    return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
  }, [anchor]);

  const phasesQ = usePhases(range.from, range.to);
  const today = phasesQ.data?.today ?? localToday;
  const phases = useMemo(() => phasesQ.data?.events ?? [], [phasesQ.data]);
  const emailsQ = useCalendarEmails(range.from, range.to);
  const emails = useMemo(() => emailsQ.data?.emails ?? [], [emailsQ.data]);
  const undatedAll = emailsQ.data?.undatedDrafts ?? [];
  const canApprove = emailsQ.data?.canApprove ?? false;
  const needed = useApprovalsNeeded(true);
  const waiting = needed.data?.items ?? [];
  // An undated draft waiting for approval is already in that list above.
  const undated = useMemo(() => {
    const listed = new Set(waiting.map(w => w.id));
    return undatedAll.filter(d => !listed.has(d.id));
  }, [undatedAll, waiting]);
  const setDates = useSetPhaseDates();

  // The email panel always shows the freshest copy (after approving, say).
  const currentEmail = useMemo(() => {
    if (!openEmail) return null;
    return [...emails, ...undatedAll, ...waiting].find(e => e.id === openEmail.id) ?? openEmail;
  }, [openEmail, emails, undatedAll, waiting]);

  const onDatesChange = (p: Phase, next: { startDate: string; endDate: string }, _mode: DragMode) => {
    setDragError(null);
    setDates.mutate({ id: p.id, ...next }, {
      onError: err => setDragError(`Couldn't move “${p.title}”: ${(err as Error).message}`),
    });
  };

  const monthEnd = addMonths(anchor, 1);
  const monthLast = addDays(monthEnd, -1);
  const monthPhases = phases.filter(p => overlaps(p, anchor, monthLast));
  const monthEmails = emails.filter(m => m.date != null && m.date >= anchor && m.date < monthEnd);
  const inThisMonth = today >= anchor && today < monthEnd;
  const newPhase = (on: string) => setOpen({ id: null, newOn: on, key: Date.now() });
  const monthName = `${MONTH_NAMES[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4 scroll-mt-4">
      {/* Title row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-primary" /> Marketing calendar
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/test-boxes" className="px-3.5 py-2.5 rounded-xl border-2 border-border text-sm font-semibold flex items-center gap-1.5 hover:bg-secondary/50">
            <Package className="w-4 h-4" /> Test boxes
          </Link>
          <button onClick={() => setOffersOpen(true)}
            className="px-3.5 py-2.5 rounded-xl border-2 border-violet-500/40 text-sm font-semibold flex items-center gap-1.5 hover:bg-violet-500/10">
            <Tag className="w-4 h-4 text-violet-600" /> Offers
          </button>
          <button onClick={() => setReuseOpen(true)}
            className="px-3.5 py-2.5 rounded-xl border-2 border-violet-500/40 text-sm font-semibold flex items-center gap-1.5 hover:bg-violet-500/10">
            <Copy className="w-4 h-4 text-violet-600" /> Re-use a past phase
          </button>
          <button onClick={() => newPhase(inThisMonth ? today : anchor)}
            className="px-3.5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/90">
            <Plus className="w-4 h-4" /> Add phase
          </button>
        </div>
      </div>

      {/* Emails waiting for approval (everyone sees the list; approvers get the button). */}
      {waiting.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-500/50 bg-amber-500/10 p-3 sm:p-4 space-y-3" role="status">
          <p className="text-base font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0" />
            {waiting.length} Klaviyo email{waiting.length === 1 ? "" : "s"} need{waiting.length === 1 ? "s" : ""} approval
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-2">
            {waiting.map(m => <EmailCard key={m.id} email={m} canApprove={canApprove} onOpen={() => setOpenEmail(m)} />)}
          </div>
          {needed.data?.klaviyoError && <p className="text-sm text-amber-800 dark:text-amber-300">{needed.data.klaviyoError}</p>}
        </div>
      )}

      {/* Navigation row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button onClick={() => setAnchor(a => addMonths(a, -1))} className="p-2.5 rounded-xl border-2 border-border hover:bg-secondary/50" aria-label="Previous month">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="min-w-[9.5rem] text-center text-base font-bold">{monthName}</span>
          <button onClick={() => setAnchor(a => addMonths(a, 1))} className="p-2.5 rounded-xl border-2 border-border hover:bg-secondary/50" aria-label="Next month">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <button onClick={() => setAnchor(monthStart(today))} className="px-3 py-2.5 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary/50">Today</button>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="sr-only sm:not-sr-only">Jump to</span>
          <input
            type="month"
            value={anchor.slice(0, 7)}
            onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setAnchor(`${e.target.value}-01`); }}
            className="px-2.5 py-2 rounded-xl border-2 border-border bg-background text-sm text-foreground"
            aria-label="Jump to month"
          />
        </label>
      </div>

      {phasesQ.isError && (
        <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(phasesQ.error as Error).message}</p>
      )}
      {dragError && (
        <div className="rounded-xl border-2 border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600" /><span className="flex-1">{dragError}</span>
          <button onClick={() => setDragError(null)} aria-label="Dismiss" className="p-1"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="relative">
        {phasesQ.isLoading && !phasesQ.data && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        )}
        <MonthGrid
          month={anchor}
          today={today}
          phases={phases}
          emails={emails}
          onOpenPhase={p => setOpen({ id: p.id, key: p.id })}
          onOpenEmail={setOpenEmail}
          onAddOn={newPhase}
          onDatesChange={onDatesChange}
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        <span className="inline-flex items-center gap-1.5"><span className={cn("w-6 h-3 rounded-sm", PHASE_TONE.edge)} />Phase (drag to move, drag its end to stretch)</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn("inline-flex items-center justify-center w-5 h-4 rounded", KLAVIYO_TONE.draft)}><PencilLine className="w-3 h-3" /></span>Klaviyo draft</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn("inline-flex items-center justify-center w-5 h-4 rounded", KLAVIYO_TONE.solid)}><Mail className="w-3 h-3" /></span>Klaviyo scheduled</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn("inline-flex items-center justify-center w-5 h-4 rounded", KLAVIYO_TONE.sent)}><Mail className="w-3 h-3" /></span>Sent</span>
        <span className="inline-flex items-center gap-1.5"><BadgeCheck className="w-4 h-4 text-emerald-600" />Approved</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" />Needs approval</span>
      </div>
      {emailsQ.data?.error && <p className="text-sm text-amber-700 dark:text-amber-400">Klaviyo emails: {emailsQ.data.error}</p>}
      {emailsQ.data && !emailsQ.data.connected && <p className="text-sm text-muted-foreground">Klaviyo isn't connected, so no emails show.</p>}

      {/* Klaviyo drafts that have no send date yet. */}
      {undated.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Klaviyo drafts without a date</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-2">
            {undated.map(m => <EmailCard key={m.id} email={m} canApprove={canApprove} onOpen={() => setOpenEmail(m)} />)}
          </div>
        </div>
      )}

      {/* This month as big cards (the grid is small on a phone). */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Phases in {monthName}</h3>
        {monthPhases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No phases this month yet — tap a day to add one.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
            {monthPhases.map(p => <PhaseCard key={p.id} phase={p} today={today} onOpen={() => setOpen({ id: p.id, key: p.id })} />)}
          </div>
        )}
      </div>
      {monthEmails.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Klaviyo emails in {monthName}</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-2">
            {monthEmails.map(m => <EmailCard key={m.id} email={m} canApprove={canApprove} onOpen={() => setOpenEmail(m)} />)}
          </div>
        </div>
      )}

      <Suggestions />

      {offersOpen && <OffersManager onClose={() => setOffersOpen(false)} />}
      {reuseOpen && (
        <ReusePhase
          defaultStart={inThisMonth ? today : anchor}
          onClose={() => setReuseOpen(false)}
          onCreated={id => { setReuseOpen(false); setOpen({ id, key: id }); }}
        />
      )}
      {currentEmail && <EmailPanel email={currentEmail} canApprove={canApprove} onClose={() => setOpenEmail(null)} />}
      {open && (
        <PhaseModal key={open.key} phaseId={open.id} newOn={open.newOn} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}

function PhaseCard({ phase: p, today, onOpen }: { phase: Phase; today: string; onOpen: () => void }) {
  const running = p.startDate <= today && p.endDate >= today;
  const group = customerGroupChip(p.customerGroup);
  return (
    <button onClick={onOpen} className={cn("text-left rounded-2xl border-2 bg-background hover:bg-secondary/30 overflow-hidden flex", PHASE_TONE.card, p.endDate < today && "opacity-70")}>
      <span className={cn("w-2 flex-shrink-0", PHASE_TONE.edge)} />
      <span className="flex-1 min-w-0 p-3.5 space-y-1.5">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-bold break-words">{p.title}</span>
          {running && <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-primary text-primary-foreground">On now</span>}
        </span>
        <span className="block text-sm font-semibold">{formatRange(p.startDate, p.endDate)}</span>
        {(p.offers.length > 0 || group) && (
          <span className="flex flex-wrap gap-1.5">
            {p.offers.map(o => (
              <span key={o} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold break-words", PHASE_TONE.chip)}>
                <Tag className="w-3.5 h-3.5 flex-shrink-0" />{o}
              </span>
            ))}
            {group && <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-sm font-semibold"><Users className="w-3.5 h-3.5" />{group}</span>}
          </span>
        )}
        {p.notes && <span className="block text-sm text-muted-foreground line-clamp-2 whitespace-pre-line">{p.notes}</span>}
      </span>
    </button>
  );
}

function EmailCard({ email: m, canApprove, onOpen }: { email: CalEmail; canApprove: boolean; onOpen: () => void }) {
  return (
    <div className={cn("rounded-2xl border-2 bg-background p-3 flex gap-3 items-start", m.status === "Draft" ? "border-dashed border-teal-500/60" : "border-teal-500/40", m.status === "Sent" && "opacity-75")}>
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left flex gap-3">
        {m.status === "Draft"
          ? <PencilLine className={cn("w-5 h-5 flex-shrink-0 mt-0.5", KLAVIYO_TONE.icon)} />
          : <Mail className={cn("w-5 h-5 flex-shrink-0 mt-0.5", KLAVIYO_TONE.icon)} />}
        <span className="min-w-0 space-y-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {emailStatusLabel(m.status)} · {m.date ? format(parseISO(m.sendAt ?? m.date), m.sendAt ? "EEE d MMM, HH:mm" : "EEE d MMM") : "no date yet"}
          </span>
          <span className="block font-semibold break-words">{m.subject ?? m.name}</span>
          {m.subject && <span className="block text-sm text-muted-foreground break-words">{m.name}</span>}
          <ApprovalBadge email={m} className="mt-1" />
        </span>
      </button>
      {canApprove && m.status !== "Sent" && m.approval.status !== "approved" && (
        <div className="flex-shrink-0" title={sendLine(m)}><ApproveButton email={m} size="small" /></div>
      )}
    </div>
  );
}

/** AI ideas for the uncovered weeks; each can be locked in as a phase. */
function Suggestions() {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const create = useCreatePhase();
  const suggest = useMutation({
    mutationFn: () => calApi<{ suggestions: Suggestion[] }>("/marketing-calendar/suggest-events", { method: "POST", body: "{}" }),
    onSuccess: r => { setItems(r.suggestions); setMessage(r.suggestions.length ? null : "No suggestions came back — the next 8 weeks may already be covered."); },
    onError: (e: Error) => setMessage(e.message),
  });

  return (
    <div className="space-y-2 pt-1">
      <button onClick={() => suggest.mutate()} disabled={suggest.isPending}
        className="px-3.5 py-2.5 rounded-xl border-2 border-primary/40 text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/10 disabled:opacity-50">
        {suggest.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-primary" />}
        {suggest.isPending ? "Thinking…" : "Suggest phases for the gaps"}
      </button>
      {message && (
        <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span className="flex-1">{message}</span>
          <button onClick={() => setMessage(null)} className="p-1 text-muted-foreground" aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      {items.map((s, i) => (
        <div key={i} className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-3.5 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold break-words">{s.name}</p>
            <p className="text-sm text-muted-foreground">{formatRange(s.startDate, s.endDate)} · {s.offerIdea}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{s.angle}</p>
          </div>
          <button
            onClick={() => create.mutate(
              { title: s.name, startDate: s.startDate, endDate: s.endDate, offers: [s.offerIdea], notes: s.angle, source: "ai" },
              { onSuccess: () => setItems(list => list.filter(x => x !== s)), onError: err => setMessage((err as Error).message) },
            )}
            disabled={create.isPending}
            className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            <Lock className="w-4 h-4" /> Lock in
          </button>
          <button onClick={() => setItems(list => list.filter(x => x !== s))} className="p-2 rounded-lg text-muted-foreground hover:bg-secondary/50" aria-label="Dismiss suggestion">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
