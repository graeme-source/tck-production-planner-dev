/**
 * The marketing calendar on the Sales & Marketing page (Graeme, 2026-09-29).
 * Graeme and the marketing team plan here together: a month grid and a
 * Gantt-style timeline over the same events, drag to move or stretch, tap to
 * open, tap an empty day to add. Objective I — there is always something on,
 * planned far enough ahead (Black Friday can be planned in September).
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { format, parseISO, formatDistanceToNowStrict } from "date-fns";
import {
  CalendarDays, ChevronLeft, ChevronRight, GanttChartSquare, Loader2, Lock, Megaphone, Package, Plus, Sparkles, X, AlertTriangle,
} from "lucide-react";
import {
  addDays, addMonths, formatRange, monthGridWeeks, monthStart, overlaps, timelineRange, type DragMode, type TimelineZoom,
} from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import { calApi, useCalendarEvents, useCreateEvent, useSetEventDates, type CalEvent, type Suggestion } from "./api";
import { EVENT_TYPES, firstName, statusLabel, typeStyle } from "./constants";
import { MonthGrid } from "./month-grid";
import { Timeline, timelineMonths } from "./timeline";
import { EventModal } from "./event-modal";

type View = "month" | "timeline";
const VIEW_KEY = "tck_marketing_calendar_view";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function readView(): View {
  try { return localStorage.getItem(VIEW_KEY) === "timeline" ? "timeline" : "month"; } catch { return "month"; }
}
function saveView(v: View) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* per-device nicety only */ }
}
function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

export function MarketingCalendar({ gapWeeks = [] }: { gapWeeks?: string[] }) {
  const [view, setView] = useState<View>(readView);
  const [zoom, setZoom] = useState<TimelineZoom>("weeks");
  const [anchor, setAnchor] = useState(() => monthStart(londonToday()));
  const [open, setOpen] = useState<{ id: number | null; newOn?: string } | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (view === "month") {
      const weeks = monthGridWeeks(anchor);
      return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
    }
    return timelineRange(anchor, timelineMonths(zoom));
  }, [view, anchor, zoom]);

  const { data, isLoading, isError, error } = useCalendarEvents(range.from, range.to);
  const today = data?.today ?? londonToday();
  const events = data?.events ?? [];
  const setDates = useSetEventDates();

  const onDatesChange = (e: CalEvent, next: { startDate: string; endDate: string }, _mode: DragMode) => {
    setDragError(null);
    setDates.mutate({ id: e.id, ...next }, {
      onError: err => setDragError(`Couldn't move “${e.title}”: ${(err as Error).message}`),
    });
  };

  const monthEnd = addMonths(anchor, 1);
  const monthEvents = events.filter(e => overlaps(e, anchor, addDays(monthEnd, -1)));

  const changeView = (v: View) => { setView(v); saveView(v); };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4">
      {/* Title row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-primary" /> Marketing calendar
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/test-boxes" className="px-3.5 py-2 rounded-xl border-2 border-rose-500/40 text-rose-700 dark:text-rose-300 text-sm font-semibold flex items-center gap-1.5 hover:bg-rose-500/10">
            <Package className="w-4 h-4" /> Test boxes
          </Link>
          <button onClick={() => setOpen({ id: null, newOn: today >= anchor && today < monthEnd ? today : anchor })}
            className="px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/90">
            <Plus className="w-4 h-4" /> Add event
          </button>
        </div>
      </div>

      {/* Navigation row */}
      <div className="flex items-center gap-2 flex-wrap">
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
            onOpen={e => setOpen({ id: e.id })}
            onAddOn={d => setOpen({ id: null, newOn: d })}
            onDatesChange={onDatesChange}
          />
        ) : (
          <Timeline
            anchor={anchor}
            zoom={zoom}
            today={today}
            events={events}
            onOpen={e => setOpen({ id: e.id })}
            onAddOn={d => setOpen({ id: null, newOn: d })}
            onDatesChange={onDatesChange}
          />
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Drag an event to move it · drag its end to stretch it · tap an empty day to add one.
      </p>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {Object.entries(EVENT_TYPES).map(([k, t]) => (
          <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("w-3 h-3 rounded-full", t.dot)} />{t.label}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rotate-45 bg-rose-600" />Test-box deadline</span>
      </div>

      {gapWeeks.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Nothing locked in for: {gapWeeks.map(w => `w/c ${format(parseISO(w), "d MMM")}`).join(", ")}
        </p>
      )}

      {/* This month as big cards */}
      {view === "month" && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            In {MONTH_NAMES[Number(anchor.slice(5, 7)) - 1]}
          </h3>
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
