/**
 * The marketing calendar on the Sales & Marketing page (Graeme, 2026-09-29).
 * Graeme and the marketing team plan here together: a month grid, a List of
 * upcoming emails grouped by campaign, and a Gantt-style timeline over the
 * same data. Drag to move or stretch, tap to open, tap an empty day to add a
 * campaign or an email. Objective I — there is always something on, planned
 * far enough ahead (Black Friday can be planned in September).
 *
 * Campaigns are the calendar events (dated periods). Planned emails (2026-09-30)
 * belong to a campaign automatically by their send day.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { format, parseISO, formatDistanceToNowStrict } from "date-fns";
import {
  BadgeCheck, CalendarDays, ChevronLeft, ChevronRight, GanttChartSquare, List, Loader2, Lock, Mail, MailPlus, Megaphone, Package, Plus, Sparkles, X, AlertTriangle,
} from "lucide-react";
import {
  addDays, addMonths, formatRange, monthGridWeeks, monthStart, overlaps, stageLabel, timelineRange, type DragMode, type TimelineZoom,
} from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import {
  calApi, useCalendarEvents, useCreateEvent, useKlaviyoEmails, useMoveEmail, usePlannedEmails, useSetEventDates,
  type CalEvent, type KlaviyoEmail, type PlannedEmail, type Suggestion,
} from "./api";
import { EmailModal } from "./email-modal";
import { EVENT_TYPES, firstName, statusLabel, typeStyle } from "./constants";
import { MonthGrid } from "./month-grid";
import { Timeline, timelineMonths } from "./timeline";
import { EventModal } from "./event-modal";
import { ListView } from "./list-view";
import { PlannedEmailModal } from "./planned-email-modal";
import { ApprovalBadge, useApprovalIndex } from "./approvals";

type View = "month" | "list" | "timeline";
export type ListFilter = "all" | "needs";
const VIEW_KEY = "tck_marketing_calendar_view";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "timeline" || v === "list" ? v : "month";
  } catch { return "month"; }
}
function saveView(v: View) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* per-device nicety only */ }
}
function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

export function MarketingCalendar({ reviewSignal = 0 }: {
  /** Bumped by the page's "need your approval — Review" banner: jump to the
   *  List view filtered to Needs approval. */
  reviewSignal?: number;
} = {}) {
  const [view, setView] = useState<View>(readView);
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!reviewSignal) return;
    setView("list");
    setListFilter("needs");
    // After the List view has rendered, so the jump lands on it.
    const t = window.setTimeout(() => sectionRef.current?.scrollIntoView({ block: "start" }), 150);
    return () => window.clearTimeout(t);
  }, [reviewSignal]);
  const [zoom, setZoom] = useState<TimelineZoom>("weeks");
  const [anchor, setAnchor] = useState(() => monthStart(londonToday()));
  const [open, setOpen] = useState<{ id: number | null; newOn?: string } | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [openEmail, setOpenEmail] = useState<KlaviyoEmail | null>(null);
  const [openPlanned, setOpenPlanned] = useState<{ id: number | null; newOn?: string; key: number } | null>(null);
  const [addChoice, setAddChoice] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const localToday = londonToday();

  const range = useMemo(() => {
    if (view === "month") {
      const weeks = monthGridWeeks(anchor);
      return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
    }
    if (view === "list") {
      // Upcoming: today to a year out; with "Show past", six months back too.
      return { from: showPast ? addMonths(monthStart(localToday), -6) : localToday, to: addDays(localToday, 365) };
    }
    return timelineRange(anchor, timelineMonths(zoom));
  }, [view, anchor, zoom, showPast, localToday]);

  const { data, isLoading, isError, error } = useCalendarEvents(range.from, range.to);
  const today = data?.today ?? localToday;
  const events = data?.events ?? [];
  // Klaviyo sends (sent + scheduled one-off campaigns) — read-only.
  // Drafts come too; they appear in the List view and wherever they're
  // linked to a plan, but never clutter the month grid or timeline.
  const klaviyo = useKlaviyoEmails(range.from, range.to, true, { recentDrafts: true });
  const emails = useMemo(() => klaviyo.data?.emails ?? [], [klaviyo.data]);
  // For approvals only: recent drafts whatever their placeholder day, so a
  // plan linked to a draft outside this range still gets its stage and
  // subject line from Klaviyo (same as the server's reminder count).
  const approvalKlaviyo = useMemo(() => {
    const seen = new Set(emails.map(e => e.id));
    return [...emails, ...(klaviyo.data?.recentDrafts ?? []).filter(d => !seen.has(d.id))];
  }, [emails, klaviyo.data]);
  const calendarEmails = useMemo(() => emails.filter(m => m.status !== "Draft"), [emails]);
  const setDates = useSetEventDates();
  // Our planned emails in the same range.
  const plannedQ = usePlannedEmails(range.from, range.to);
  const planned = useMemo(() => plannedQ.data?.emails ?? [], [plannedQ.data]);
  // Approval status for everything in view (everyone sees it).
  const approvals = useApprovalIndex(planned, approvalKlaviyo, today);
  const needsCount = approvals.items.filter(i => i.needsApproval).length;
  const moveEmail = useMoveEmail();
  const onMovePlanned = (e: PlannedEmail, sendDate: string) => {
    setDragError(null);
    moveEmail.mutate({ id: e.id, sendDate }, {
      onError: err => setDragError(`Couldn't move “${e.subject}”: ${(err as Error).message}`),
    });
  };
  const addEmail = (on: string) => setOpenPlanned({ id: null, newOn: on, key: Date.now() });

  const onDatesChange = (e: CalEvent, next: { startDate: string; endDate: string }, _mode: DragMode) => {
    setDragError(null);
    setDates.mutate({ id: e.id, ...next }, {
      onError: err => setDragError(`Couldn't move “${e.title}”: ${(err as Error).message}`),
    });
  };

  const monthEnd = addMonths(anchor, 1);
  const monthEvents = events.filter(e => overlaps(e, anchor, addDays(monthEnd, -1)));
  const monthPlanned = planned.filter(p => p.sendDate >= anchor && p.sendDate < monthEnd);
  const linkedIds = new Set(planned.map(p => p.klaviyoCampaignId).filter(Boolean));
  const monthEmails = calendarEmails.filter(m => m.date >= anchor && m.date < monthEnd && !linkedIds.has(m.id));

  const changeView = (v: View) => { setView(v); saveView(v); };

  return (
    <section ref={sectionRef} className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4 scroll-mt-4">
      {/* Title row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-primary" /> Marketing calendar
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/test-boxes" className="px-3.5 py-2 rounded-xl border-2 border-rose-500/40 text-rose-700 dark:text-rose-300 text-sm font-semibold flex items-center gap-1.5 hover:bg-rose-500/10">
            <Package className="w-4 h-4" /> Test boxes
          </Link>
          <button onClick={() => setOpen({ id: null, newOn: view === "list" || (today >= anchor && today < monthEnd) ? today : anchor })}
            className="px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/90">
            <Plus className="w-4 h-4" /> Add campaign
          </button>
          <button onClick={() => addEmail(view === "list" || (today >= anchor && today < monthEnd) ? today : anchor)}
            className="px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold flex items-center gap-1.5 hover:bg-indigo-700">
            <MailPlus className="w-4 h-4" /> Add email
          </button>
        </div>
      </div>

      {/* Navigation row */}
      <div className="flex items-center gap-2 flex-wrap">
        {view === "list" ? (<>
          <Segmented
            value={listFilter}
            onChange={v => setListFilter(v as ListFilter)}
            options={[
              { value: "all", label: "All emails" },
              { value: "needs", label: `Needs approval${approvals.loaded ? ` (${needsCount})` : ""}` },
            ]}
          />
          {listFilter === "all" && (
            <label className="flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-xl border-2 border-border cursor-pointer">
              <input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} className="w-4 h-4" />
              Show past
            </label>
          )}
        </>) : (<>
        <div className="flex items-center gap-1">
          <button onClick={() => setAnchor(a => addMonths(a, -1))} className="p-2 rounded-xl border-2 border-border hover:bg-secondary/50" aria-label="Previous month">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="min-w-[9.5rem] text-center text-base font-bold">
            {MONTH_NAMES[Number(anchor.slice(5, 7)) - 1]} {anchor.slice(0, 4)}
          </span>
          <button onClick={() => setAnchor(a => addMonths(a, 1))} className="p-2 rounded-xl border-2 border-border hover:bg-secondary/50" aria-label="Next month">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <button onClick={() => setAnchor(monthStart(today))} className="px-3 py-2 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary/50">Today</button>
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
        </>)}
        <div className="flex-1" />
        {view === "timeline" && (
          <Segmented
            value={zoom}
            onChange={v => setZoom(v as TimelineZoom)}
            options={[{ value: "weeks", label: "Weeks" }, { value: "months", label: "Months" }]}
          />
        )}
        <Segmented
          value={view}
          onChange={v => changeView(v as View)}
          options={[
            { value: "month", label: "Month", icon: <CalendarDays className="w-4 h-4" /> },
            { value: "list", label: "List", icon: <List className="w-4 h-4" /> },
            { value: "timeline", label: "Timeline", icon: <GanttChartSquare className="w-4 h-4" /> },
          ]}
        />
      </div>

      {isError && (
        <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(error as Error).message}</p>
      )}
      {dragError && (
        <div className="rounded-xl border-2 border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600" /><span className="flex-1">{dragError}</span>
          <button onClick={() => setDragError(null)} aria-label="Dismiss" className="p-1"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="relative">
        {isLoading && !data && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        )}
        {view === "month" ? (
          <MonthGrid
            month={anchor}
            today={today}
            events={events}
            emails={calendarEmails}
            planned={planned}
            approvals={approvals}
            onOpen={e => setOpen({ id: e.id })}
            onOpenEmail={setOpenEmail}
            onOpenPlanned={p => setOpenPlanned({ id: p.id, key: p.id })}
            onMovePlanned={onMovePlanned}
            onAddOn={setAddChoice}
            onDatesChange={onDatesChange}
          />
        ) : view === "list" ? (
          <ListView
            today={today}
            events={events}
            planned={planned}
            klaviyo={emails}
            showPast={listFilter === "all" && showPast}
            filter={listFilter}
            approvals={approvals}
            onShowAll={() => setListFilter("all")}
            onOpenCampaign={id => setOpen({ id })}
            onOpenEmail={id => setOpenPlanned({ id, key: id })}
            onOpenKlaviyo={setOpenEmail}
            onAddEmail={addEmail}
          />
        ) : (
          <Timeline
            anchor={anchor}
            zoom={zoom}
            today={today}
            events={events}
            emails={calendarEmails}
            onOpen={e => setOpen({ id: e.id })}
            onOpenEmail={setOpenEmail}
            onAddOn={setAddChoice}
            onDatesChange={onDatesChange}
          />
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {view === "list"
          ? "Emails belong to the phase running on their send day · tap a phase's name to rename it or change its dates."
          : "Drag a phase to move it · drag its end to stretch it · drag an email to another day · tap an empty day to add a phase or email."}
      </p>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {Object.entries(EVENT_TYPES).map(([k, t]) => (
          <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("w-3 h-3 rounded-full", t.dot)} />{t.label}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rotate-45 bg-rose-600" />Test-box deadline</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-flex items-center justify-center w-5 h-4 rounded bg-indigo-600"><MailPlus className="w-3 h-3 text-white" /></span>Planned email (drag to move)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-flex items-center justify-center w-5 h-4 rounded border-2 border-sky-500"><Mail className="w-3 h-3 text-sky-600" /></span>Klaviyo send, read-only (faded = sent; drafts are in the List view)</span>
        <span className="inline-flex items-center gap-1.5"><BadgeCheck className="w-4 h-4 text-emerald-600" />Approved</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" />Needs approval</span>
      </div>
      {klaviyo.data?.error && <p className="text-sm text-amber-700 dark:text-amber-400">Klaviyo emails: {klaviyo.data.error}</p>}


      {/* This month as big cards */}
      {view === "month" && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            In {MONTH_NAMES[Number(anchor.slice(5, 7)) - 1]}
          </h3>
          {monthPlanned.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {monthPlanned.map(p => (
                <button key={p.id} type="button" onClick={() => setOpenPlanned({ id: p.id, key: p.id })}
                  className="text-left rounded-2xl border-2 border-indigo-500/50 bg-indigo-500/5 p-4 flex gap-3 hover:bg-indigo-500/10">
                  <MailPlus className="w-5 h-5 flex-shrink-0 mt-0.5 text-indigo-600" />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {format(parseISO(p.sendDate), "EEE d MMM")}{p.sendTime ? `, ${p.sendTime}` : ""} · {stageLabel(approvals.forPlan(p.id)?.stage ?? p.status)}{p.klaviyoCampaignId ? " · in Klaviyo ✓" : ""}
                    </span>
                    <span className="block font-semibold truncate">{p.subject}</span>
                    <span className="block text-sm text-muted-foreground truncate">{p.campaignTitle ? `In “${p.campaignTitle}”` : "Not in a phase"}</span>
                    {approvals.forPlan(p.id) && <ApprovalBadge item={approvals.forPlan(p.id)!} row={approvals.row(approvals.forPlan(p.id)!.key)} />}
                  </span>
                </button>
              ))}
            </div>
          )}
          {monthEmails.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {monthEmails.map(m => (
                <button key={m.id} type="button" onClick={() => setOpenEmail(m)}
                  className={cn("text-left rounded-2xl border-2 p-4 flex gap-3 hover:bg-secondary/30", m.status === "Sent" ? "border-sky-500/25" : "border-sky-500/60")}>
                  <Mail className={cn("w-5 h-5 flex-shrink-0 mt-0.5", m.status === "Sent" ? "text-sky-600/60" : "text-sky-600")} />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {format(parseISO(m.sendAt), "EEE d MMM, HH:mm")} · {m.status}
                    </span>
                    <span className="block font-semibold truncate">{m.name}</span>
                    <span className="block text-sm text-muted-foreground truncate">{m.subject ?? "No subject line"}</span>
                    {approvals.forKlaviyo(m.id) && <ApprovalBadge item={approvals.forKlaviyo(m.id)!} row={approvals.row(approvals.forKlaviyo(m.id)!.key)} className="mt-1" />}
                  </span>
                </button>
              ))}
            </div>
          )}
          {monthEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing planned this month yet — tap a day to add something.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {monthEvents.map(e => <EventCard key={e.id} event={e} today={today} onOpen={() => setOpen({ id: e.id })} />)}
            </div>
          )}
        </div>
      )}

      <Suggestions />

      {openEmail && <EmailModal email={openEmail} today={today} onClose={() => setOpenEmail(null)} />}
      {addChoice && (
        <AddChoice
          date={addChoice}
          onClose={() => setAddChoice(null)}
          onCampaign={() => { setOpen({ id: null, newOn: addChoice }); setAddChoice(null); }}
          onEmail={() => { addEmail(addChoice); setAddChoice(null); }}
        />
      )}
      {openPlanned && (
        <PlannedEmailModal
          key={openPlanned.key}
          emailId={openPlanned.id}
          newOn={openPlanned.newOn}
          onClose={() => setOpenPlanned(null)}
          onOpenCampaign={id => setOpen({ id })}
        />
      )}
      {open && (
        <EventModal
          key={open.id ?? `new-${open.newOn}`}
          eventId={open.id}
          newOn={open.newOn}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

/** Tapped an empty day: a campaign starting here, or an email sending here? */
function AddChoice({ date, onClose, onCampaign, onEmail }: { date: string; onClose: () => void; onCampaign: () => void; onEmail: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-sm max-h-[92dvh] overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Add on ${date}`}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <h2 className="flex-1 font-bold text-lg">Add on {format(parseISO(date), "EEE d MMM")}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-4 grid gap-3">
          <button type="button" onClick={onCampaign} autoFocus className="rounded-2xl border-2 border-violet-500/40 p-4 text-left flex items-center gap-3 hover:bg-violet-500/10">
            <Megaphone className="w-6 h-6 text-violet-600 flex-shrink-0" />
            <span><span className="block font-bold text-base">Add phase</span><span className="block text-sm text-muted-foreground">A period like “Early Black Friday”, starting this day</span></span>
          </button>
          <button type="button" onClick={onEmail} className="rounded-2xl border-2 border-indigo-500/40 p-4 text-left flex items-center gap-3 hover:bg-indigo-500/10">
            <MailPlus className="w-6 h-6 text-indigo-600 flex-shrink-0" />
            <span><span className="block font-bold text-base">Add email</span><span className="block text-sm text-muted-foreground">A planned send on this day — it joins the phase running then</span></span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Segmented({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string; icon?: React.ReactNode }>;
}) {
  return (
    <div className="inline-flex rounded-xl border-2 border-border p-0.5 bg-background">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "px-3 py-1.5 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/50",
          )}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

function EventCard({ event: e, today, onOpen }: { event: CalEvent; today: string; onOpen: () => void }) {
  const style = typeStyle(e.type);
  const running = e.startDate <= today && e.endDate >= today && e.status !== "idea";
  return (
    <button onClick={onOpen} className="text-left rounded-2xl border-2 border-border bg-background hover:bg-secondary/30 overflow-hidden flex">
      <span className={cn("w-2 flex-shrink-0", style.dot)} />
      <span className="flex-1 min-w-0 p-3.5 space-y-1">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-bold truncate">{e.title}</span>
          {running && <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-primary text-primary-foreground">On now</span>}
        </span>
        <span className="flex items-center gap-2 flex-wrap text-sm">
          <span className="font-semibold">{formatRange(e.startDate, e.endDate)}</span>
          <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", style.chip)}>{style.label}</span>
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-secondary text-muted-foreground">{statusLabel(e.status)}</span>
          {e.source === "ai" && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-500/15 text-violet-700 dark:text-violet-300">AI</span>}
        </span>
        {e.summary && <span className="block text-sm text-muted-foreground line-clamp-2">{e.summary}</span>}
        <span className="block text-xs text-muted-foreground">
          {e.createdBy ? `Added by ${firstName(e.createdBy.name)}` : "Added"}
          {e.updatedBy && e.updatedAt !== e.createdAt && ` · edited by ${firstName(e.updatedBy.name)} ${formatDistanceToNowStrict(parseISO(e.updatedAt))} ago`}
        </span>
      </span>
    </button>
  );
}

/** AI ideas for the uncovered weeks; each can be locked in as an event. */
function Suggestions() {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const create = useCreateEvent();
  const suggest = useMutation({
    mutationFn: () => calApi<{ suggestions: Suggestion[] }>("/marketing-calendar/suggest-events", { method: "POST", body: "{}" }),
    onSuccess: r => { setItems(r.suggestions); setMessage(r.suggestions.length ? null : "No suggestions came back — the next 8 weeks may already be covered."); },
    onError: (e: Error) => setMessage(e.message),
  });

  return (
    <div className="space-y-2 pt-1">
      <button onClick={() => suggest.mutate()} disabled={suggest.isPending}
        className="px-3.5 py-2 rounded-xl border-2 border-primary/40 text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/10 disabled:opacity-50">
        {suggest.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-primary" />}
        {suggest.isPending ? "Thinking…" : "Suggest events for the gaps"}
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
            <p className="text-base font-semibold">{s.name}</p>
            <p className="text-sm text-muted-foreground">{formatRange(s.startDate, s.endDate)} · {s.offerIdea}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{s.angle}</p>
          </div>
          <button
            onClick={() => create.mutate(
              { title: s.name, startDate: s.startDate, endDate: s.endDate, offer: s.offerIdea, summary: s.angle.slice(0, 300), status: "planned", type: "campaign", source: "ai" },
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
