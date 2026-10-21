/**
 * The marketing calendar on the Sales & Marketing page. Objective I.
 *
 * ONE calendar (Graeme, 2026-10-20): "We just want ONE calendar, in list
 * view or calendar view, that has the emails on it. If it's something I need
 * to approve, it should show me that IN the calendar." So there is no
 * separate approvals box, phase list or email list — each Klaviyo email
 * appears once, on its send day, with its status (and an Approve button for
 * approvers) right there.
 *
 *   - LIST (default, remembered per device): weeks top to bottom, phases
 *     starting and ending in the flow with a coloured stripe on every day
 *     they cover, and ONE highlighted Today row it opens scrolled to. See
 *     agenda-list.tsx.
 *   - MONTH: the month grid — phases as bars (drag to move / stretch), email
 *     chips with a status dot.
 *   - DRAFTS: Klaviyo drafts with no send date sit in their own collapsible
 *     "Drafts" section above either view, never under Today (Graeme,
 *     2026-10-21). See drafts-section.tsx.
 *   - PHASES: dated periods with optional offers, customer group and notes;
 *     tap to edit, "+ Add phase" or "Re-use a past phase".
 *   - OFFERS: the offer library, from the "Offers" button.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle, BadgeCheck, CalendarDays, ChevronLeft, ChevronRight, Copy, List, Loader2, Lock, Mail, Megaphone, Package, PencilLine, Plus, Sparkles, Tag, X,
} from "lucide-react";
import {
  addMonths, agendaRange, formatRange, monthGridWeeks, monthStart, type DragMode,
} from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import {
  calApi, useCalendarEmails, useCreatePhase, usePhases, useSetPhaseDates,
  type CalEmail, type Phase, type Suggestion,
} from "./api";
import { PHASE_TONE } from "./constants";
import { MonthGrid } from "./month-grid";
import { PhaseModal } from "./phase-modal";
import { EmailPanel } from "./email-panel";
import { AgendaList } from "./agenda-list";
import { DraftsSection } from "./drafts-section";
import { OffersManager } from "./offers-manager";
import { ReusePhase } from "./reuse-phase";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

type View = "list" | "month";
const VIEW_KEY = "tck.marketingCalendar.view";

function readView(): View {
  try { return localStorage.getItem(VIEW_KEY) === "month" ? "month" : "list"; } catch { return "list"; }
}
function saveView(v: View) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window etc. — just don't remember */ }
}

/** How many weeks each "Show earlier" / "Show later" adds. */
const MORE_WEEKS = 4;

export function MarketingCalendar() {
  const localToday = londonToday();
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => { setViewState(v); saveView(v); };
  const [anchor, setAnchor] = useState(() => monthStart(localToday));
  const [weeksBack, setWeeksBack] = useState(2);
  const [weeksAhead, setWeeksAhead] = useState(10);
  const [todaySignal, setTodaySignal] = useState(0);
  const [open, setOpen] = useState<{ id: number | null; newOn?: string; key: number } | null>(null);
  const [openEmail, setOpenEmail] = useState<CalEmail | null>(null);
  const [offersOpen, setOffersOpen] = useState(false);
  const [reuseOpen, setReuseOpen] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (view === "list") return agendaRange(localToday, weeksBack, weeksAhead);
    const weeks = monthGridWeeks(anchor);
    return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
  }, [view, anchor, localToday, weeksBack, weeksAhead]);

  const phasesQ = usePhases(range.from, range.to);
  const today = phasesQ.data?.today ?? localToday;
  const phases = useMemo(() => phasesQ.data?.events ?? [], [phasesQ.data]);
  const emailsQ = useCalendarEmails(range.from, range.to);
  const emails = useMemo(() => emailsQ.data?.emails ?? [], [emailsQ.data]);
  const undated = useMemo(() => emailsQ.data?.undatedDrafts ?? [], [emailsQ.data]);
  const canApprove = emailsQ.data?.canApprove ?? false;
  const setDates = useSetPhaseDates();

  // The email panel always shows the freshest copy (after approving, say).
  const currentEmail = useMemo(() => {
    if (!openEmail) return null;
    return [...emails, ...undated].find(e => e.id === openEmail.id) ?? openEmail;
  }, [openEmail, emails, undated]);

  const onDatesChange = (p: Phase, next: { startDate: string; endDate: string }, _mode: DragMode) => {
    setDragError(null);
    setDates.mutate({ id: p.id, ...next }, {
      onError: err => setDragError(`Couldn't move “${p.title}”: ${(err as Error).message}`),
    });
  };

  const monthEnd = addMonths(anchor, 1);
  const inThisMonth = today >= anchor && today < monthEnd;
  const newPhaseDay = view === "list" || inThisMonth ? today : anchor;
  const newPhase = (on: string) => setOpen({ id: null, newOn: on, key: Date.now() });
  const monthName = `${MONTH_NAMES[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;
  const loading = (phasesQ.isLoading && !phasesQ.data) || (emailsQ.isLoading && !emailsQ.data);
  const settled = !!phasesQ.data && !!emailsQ.data && !phasesQ.isPlaceholderData && !emailsQ.isPlaceholderData;

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
          <button onClick={() => newPhase(newPhaseDay)}
            className="px-3.5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/90">
            <Plus className="w-4 h-4" /> Add phase
          </button>
        </div>
      </div>

      {/* View toggle + this view's navigation */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border-2 border-border p-0.5" role="tablist" aria-label="Calendar view">
          {([["list", "List", List], ["month", "Month", CalendarDays]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={cn("px-4 h-10 rounded-lg text-sm font-semibold flex items-center gap-1.5",
                view === v ? "bg-primary text-primary-foreground" : "hover:bg-secondary/50")}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
        {view === "list" ? (
          <>
            <button onClick={() => setTodaySignal(n => n + 1)} className="px-3 h-11 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary/50">Today</button>
            <span className="text-sm text-muted-foreground">{formatRange(range.from, range.to)}</span>
          </>
        ) : (
          <>
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
          </>
        )}
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
      {emailsQ.data?.error && <p className="text-sm text-amber-700 dark:text-amber-400">Klaviyo emails: {emailsQ.data.error}</p>}
      {emailsQ.data && !emailsQ.data.connected && <p className="text-sm text-muted-foreground">Klaviyo isn't connected, so no emails show.</p>}

      {/* Drafts with no send date aren't on any day — their own collapsible
          section, above the list's scroll box and the month grid alike. */}
      <DraftsSection drafts={undated} canApprove={canApprove} onOpenEmail={setOpenEmail} />

      {view === "list" ? (
        <AgendaList
          from={range.from}
          to={range.to}
          today={today}
          phases={phases}
          emails={emails}
          canApprove={canApprove}
          loading={loading}
          settled={settled}
          onOpenPhase={p => setOpen({ id: p.id, key: p.id })}
          onOpenEmail={setOpenEmail}
          onEarlier={() => setWeeksBack(n => n + MORE_WEEKS)}
          onLater={() => setWeeksAhead(n => n + MORE_WEEKS)}
          scrollToTodaySignal={todaySignal}
        />
      ) : (
        <>
          <div className="relative">
            {loading && (
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
        </>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        <span className="inline-flex items-center gap-1.5"><span className={cn("w-6 h-3 rounded-sm", PHASE_TONE.edge)} />Phase{view === "month" ? " (drag to move, drag its end to stretch)" : " (tap to edit)"}</span>
        <span className="inline-flex items-center gap-1.5"><PencilLine className="w-4 h-4 text-teal-600" />Klaviyo draft</span>
        <span className="inline-flex items-center gap-1.5"><Mail className="w-4 h-4 text-teal-600" />Klaviyo scheduled</span>
        <span className="inline-flex items-center gap-1.5"><BadgeCheck className="w-4 h-4 text-emerald-600" />Approved</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" />Needs approval</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-3 rounded-sm bg-secondary border border-border" />Sent</span>
      </div>

      <Suggestions />

      {offersOpen && <OffersManager onClose={() => setOffersOpen(false)} />}
      {reuseOpen && (
        <ReusePhase
          defaultStart={newPhaseDay}
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
