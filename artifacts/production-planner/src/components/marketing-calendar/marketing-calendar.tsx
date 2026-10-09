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
 *
 * Notes + to-dos (2026-10-01): tap a day → "Add note" for an idea or note on
 * that day (shared, attributed). Your own to-dos that are due or scheduled
 * show on their day; the founder can also switch on another calendar user's
 * (the server refuses anyone else). Both can be hidden per viewer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { format, parseISO, formatDistanceToNowStrict } from "date-fns";
import {
  BadgeCheck, CalendarDays, ChevronLeft, ChevronRight, GanttChartSquare, List, Loader2, Lock, Mail, MailPlus, Megaphone, Package, PencilLine, Plus, Sparkles, Square, StickyNote, X, AlertTriangle,
} from "lucide-react";
import {
  addDays, addMonths, filingEvents, formatRange, isNoteEvent, monthGridWeeks, monthStart, overlaps, stageLabel, timelineRange, type DragMode, type TimelineZoom,
} from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { TodoSheet } from "@/components/todo-lists";
import {
  calApi, useCalendarEvents, useCalendarTodos, useCreateEvent, useKlaviyoEmails, useMoveEmail, usePlannedEmails, useSetEventDates,
  type CalEvent, type KlaviyoEmail, type PlannedEmail, type Suggestion,
} from "./api";
import { EmailModal } from "./email-modal";
import { NoteModal } from "./note-modal";
import { EVENT_TYPES, KLAVIYO_DRAFT_TONE, KLAVIYO_TONE, NOTE_TONE, THIN_TYPES, TODO_TONE, firstName, statusLabel, typeStyle } from "./constants";
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
/** Per-viewer display choices (this device only — a nicety, never data). */
interface Layers { notes: boolean; todos: boolean; people: number[] }
const LAYERS_KEY = "tck_marketing_calendar_layers";
function readLayers(meId: number | null): Layers {
  const fallback: Layers = { notes: true, todos: true, people: [] };
  try {
    const raw = localStorage.getItem(`${LAYERS_KEY}:${meId ?? "anon"}`);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<Layers>;
    return {
      notes: v.notes !== false,
      todos: v.todos !== false,
      people: Array.isArray(v.people) ? v.people.filter((n): n is number => Number.isInteger(n)) : [],
    };
  } catch { return fallback; }
}
function saveLayers(meId: number | null, l: Layers) {
  try { localStorage.setItem(`${LAYERS_KEY}:${meId ?? "anon"}`, JSON.stringify(l)); } catch { /* per-device nicety only */ }
}

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

export function MarketingCalendar({ reviewSignal = 0 }: {
  /** Bumped by the page's "need your approval — Review" banner: jump to the
   *  List view filtered to Needs approval. */
  reviewSignal?: number;
} = {}) {
  const { state: auth } = useAuth();
  const meId = auth.status === "authenticated" ? auth.user.id : null;
  const [layers, setLayersState] = useState<Layers>(() => readLayers(meId));
  useEffect(() => { setLayersState(readLayers(meId)); }, [meId]);
  const setLayers = (next: Layers) => { setLayersState(next); saveLayers(meId, next); };
  const [openNote, setOpenNote] = useState<{ id: number | null; newOn?: string; key: number } | null>(null);
  const [openTodo, setOpenTodo] = useState<number | null>(null);
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
  const allEvents = data?.events ?? [];
  // Notes are one-day "note" events: never phases, drawn as sticky notes.
  const events = useMemo(() => filingEvents(allEvents), [allEvents]);
  const notes = useMemo(() => (layers.notes ? allEvents.filter(isNoteEvent) : []), [allEvents, layers.notes]);
  const openAny = (e: CalEvent) => (isNoteEvent(e) ? setOpenNote({ id: e.id, key: e.id }) : setOpen({ id: e.id }));

  // To-dos: mine, plus (founder only) the people switched on. The server
  // decides who may see whose; the people list comes back only for the founder.
  const [knownPeople, setKnownPeople] = useState<Array<{ id: number; name: string }>>([]);
  const askFor = layers.people.filter(id => knownPeople.some(p => p.id === id));
  const todosQ = useCalendarTodos(meId, range.from, range.to, askFor, layers.todos);
  useEffect(() => { if (todosQ.data) setKnownPeople(todosQ.data.people); }, [todosQ.data]);
  const todos = layers.todos ? todosQ.data?.todos ?? [] : [];
  // Klaviyo sends (sent + scheduled one-off campaigns) — read-only.
  // Drafts come too; they appear in the List view and wherever they're
  // linked to a plan; unlinked ones also sit on the month grid (below).
  const klaviyo = useKlaviyoEmails(range.from, range.to, true, { recentDrafts: true });
  const emails = useMemo(() => klaviyo.data?.emails ?? [], [klaviyo.data]);
  // For approvals only: recent drafts whatever their placeholder day, so a
  // plan linked to a draft outside this range still gets its stage and
  // subject line from Klaviyo (same as the server's reminder count).
  const approvalKlaviyo = useMemo(() => {
    const seen = new Set(emails.map(e => e.id));
    return [...emails, ...(klaviyo.data?.recentDrafts ?? []).filter(d => !seen.has(d.id))];
  }, [emails, klaviyo.data]);
  // Month grid (2026-10-09): drafts too, as dashed "Klaviyo draft" chips —
  // "if we build drafts in Klaviyo I'd expect them in the calendar". Ones
  // linked to a plan show once, as the plan. The timeline stays sends-only.
  const calendarEmails = useMemo(() => emails.filter(m => m.status !== "Draft"), [emails]);
  const gridEmails = useMemo(() => {
    const linkedAnywhere = new Set(klaviyo.data?.linkedCampaignIds ?? []);
    return emails.filter(m => m.status !== "Draft" || !linkedAnywhere.has(m.id));
  }, [emails, klaviyo.data]);
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
  const togglePerson = (id: number) => setLayers({
    ...layers,
    people: layers.people.includes(id) ? layers.people.filter(x => x !== id) : [...layers.people, id],
  });
  const monthPlanned = planned.filter(p => p.sendDate >= anchor && p.sendDate < monthEnd);
  const linkedIds = new Set(planned.map(p => p.klaviyoCampaignId).filter(Boolean));
  const monthEmails = gridEmails.filter(m => m.date >= anchor && m.date < monthEnd && !linkedIds.has(m.id));

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
            <Plus className="w-4 h-4" /> Add phase
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

      {/* What else shows: notes, to-dos (and, for the founder, whose). */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="text-muted-foreground font-semibold">Show:</span>
        <LayerToggle on={layers.notes} onClick={() => setLayers({ ...layers, notes: !layers.notes })} icon={<StickyNote className={cn("w-4 h-4", NOTE_TONE.icon)} />}>Notes</LayerToggle>
        <LayerToggle on={layers.todos} onClick={() => setLayers({ ...layers, todos: !layers.todos })} icon={<Square className={cn("w-4 h-4", TODO_TONE.icon)} />}>My to-dos</LayerToggle>
        {layers.todos && todosQ.data?.canViewOthers && knownPeople.map(p => (
          <LayerToggle key={p.id} on={layers.people.includes(p.id)} onClick={() => togglePerson(p.id)} icon={<Plus className="w-4 h-4" />}>
            {firstName(p.name)}'s to-dos
          </LayerToggle>
        ))}
        {layers.todos && todosQ.isError && <span className="text-destructive">To-dos: {(todosQ.error as Error).message}</span>}
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
            events={[...events, ...notes]}
            emails={gridEmails}
            planned={planned}
            todos={todos}
            onOpenTodo={t => setOpenTodo(t.id)}
            approvals={approvals}
            onOpen={openAny}
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
            notes={notes}
            todos={todos}
            onOpenNote={id => setOpenNote({ id, key: id })}
            onOpenTodo={t => setOpenTodo(t.id)}
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
            notes={notes}
            onOpen={openAny}
            onOpenEmail={setOpenEmail}
            onAddOn={setAddChoice}
            onDatesChange={onDatesChange}
          />
        )}
      </div>

      {view === "list" && (
        <p className="text-sm text-muted-foreground">
          Emails belong to the phase running on their send day · tap a phase's name to rename it or change its dates.
        </p>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {Object.entries(EVENT_TYPES).map(([k, t]) => (
          THIN_TYPES.has(k)
            ? <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("w-6 h-2 rounded-sm", t.bar)} />{t.label}</span>
            : <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("w-3 h-3 rounded-full", t.dot)} />{t.label}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rotate-45 bg-rose-600" />Test-box deadline</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-flex items-center justify-center w-5 h-4 rounded bg-indigo-600"><MailPlus className="w-3 h-3 text-white" /></span>Planned email (drag to move)</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn("inline-flex items-center justify-center w-5 h-4 rounded", KLAVIYO_TONE.solid)}><Mail className="w-3 h-3" /></span>Klaviyo email, read-only (faded = sent)</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn("inline-flex items-center justify-center w-5 h-4 rounded", KLAVIYO_DRAFT_TONE.chip)}><PencilLine className="w-3 h-3" /></span>Klaviyo draft, not linked to a plan yet</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn("inline-flex items-center justify-center w-5 h-4 rounded", NOTE_TONE.chip)}><StickyNote className={cn("w-3 h-3", NOTE_TONE.icon)} /></span>Note</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn("inline-flex items-center justify-center w-5 h-4 rounded", TODO_TONE.chip)}><Square className="w-3 h-3" /></span>To-do (struck through = done)</span>
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
                  className={cn("text-left rounded-2xl border-2 p-4 flex gap-3 hover:bg-secondary/30",
                    m.status === "Draft" ? KLAVIYO_DRAFT_TONE.card : m.status === "Sent" ? KLAVIYO_TONE.borderFaint : KLAVIYO_TONE.border)}>
                  {m.status === "Draft"
                    ? <PencilLine className={cn("w-5 h-5 flex-shrink-0 mt-0.5", KLAVIYO_DRAFT_TONE.icon)} />
                    : <Mail className={cn("w-5 h-5 flex-shrink-0 mt-0.5", KLAVIYO_TONE.icon, m.status === "Sent" && "opacity-60")} />}
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {m.status === "Draft"
                        ? `Klaviyo draft · set for ${format(parseISO(m.sendAt), "EEE d MMM")} · not linked to a planned email`
                        : `${format(parseISO(m.sendAt), "EEE d MMM, HH:mm")} · ${m.status}`}
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
          onNote={() => { setOpenNote({ id: null, newOn: addChoice, key: Date.now() }); setAddChoice(null); }}
        />
      )}
      {openNote && (
        <NoteModal key={openNote.key} noteId={openNote.id} newOn={openNote.newOn} onClose={() => setOpenNote(null)} />
      )}
      <TodoSheet open={openTodo != null} initialTaskId={openTodo} onClose={() => setOpenTodo(null)} />
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

/** Tapped an empty day: a campaign starting here, an email sending here, or a note? */
function AddChoice({ date, onClose, onCampaign, onEmail, onNote }: { date: string; onClose: () => void; onCampaign: () => void; onEmail: () => void; onNote: () => void }) {
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
          <button type="button" onClick={onNote} className="rounded-2xl border-2 border-yellow-400/60 p-4 text-left flex items-center gap-3 hover:bg-yellow-400/10">
            <StickyNote className={cn("w-6 h-6 flex-shrink-0", NOTE_TONE.icon)} />
            <span><span className="block font-bold text-base">Add note</span><span className="block text-sm text-muted-foreground">An idea or a note on this day — everyone on the calendar sees it</span></span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function LayerToggle({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "px-3 py-1.5 rounded-xl border-2 text-sm font-semibold inline-flex items-center gap-1.5 transition-colors",
        on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-secondary/50 line-through decoration-1",
      )}
    >
      {icon}{children}
    </button>
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
