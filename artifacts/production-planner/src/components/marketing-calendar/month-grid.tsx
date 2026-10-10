/**
 * Month view: Monday-start weeks, events as bars spanning their days and
 * wrapping onto the next week. Drag a bar to move it, drag its end to
 * stretch or shrink it, tap a bar to open it, tap an empty day to add one.
 *
 * Phases are a thin pale band (a backdrop, not an entry). Emails are
 * one-day chips: our planned emails are SOLID indigo, Klaviyo sends SOLID
 * teal (faded once sent) and read-only. Drag a planned email to another
 * day and it re-files into that day's phase. A plan linked to its Klaviyo send
 * shows once, as the planned chip with a tick (the server links most of them
 * automatically — lib/klaviyo-auto-link.ts). Unlinked Klaviyo drafts show as
 * dashed violet "Klaviyo draft" chips on their placeholder day (2026-10-09).
 * Approval: a green tick badge or an amber dot.
 *
 * Notes (2026-10-01) are quiet yellow sticky-note chips on their day — drag
 * one to another day, tap to open. To-dos are slate checkbox chips (done =
 * faded and struck through), someone else's carrying their initials; tap
 * opens the to-do.
 */
import { useMemo, useState } from "react";
import { initials, isNoteEvent, layoutWeek, monthGridWeeks } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import type { CalEvent, CalTodo, KlaviyoEmail, Milestone, PlannedEmail } from "./api";
import { CheckCircle2, CheckSquare, ListTodo, Mail, MailPlus, PencilLine, Square, StickyNote } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format, parseISO } from "date-fns";
import { groupTodosByDay, todoGroupLabel } from "@/lib/calendar-todo-groups";
import { typeStyle, firstName, THIN_TYPES, KLAVIYO_TONE, KLAVIYO_DRAFT_TONE, NOTE_TONE, TODO_TONE } from "./constants";
import { dateFromElementsAt, useSpanDrag } from "./use-span-drag";
import { ApprovalDot, approvalTitle, type ApprovalIndex } from "./approvals";
import type { DragMode } from "@workspace/marketing-calendar";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HEADER_PX = 30;
const BAR_PX = 28;
const THIN_PX = 18;
const GAP_PX = 4;

/** A Klaviyo email as a one-day span, so it takes a lane like an event. */
type EmailSpan = { id: number; startDate: string; endDate: string; email: KlaviyoEmail };
/** A planned email: `plan` is what the drag hook moves (its real id). */
type PlanDrag = { id: number; startDate: string; endDate: string; email: PlannedEmail };
type PlanSpan = { id: number; startDate: string; endDate: string; plan: PlanDrag };
/** A to-do on its day (read-only here; tap opens it). */
type TodoSpan = { id: number; startDate: string; endDate: string; todo: CalTodo };
/** A busy day's to-dos as one chip (2026-10-02). */
type TodoGroupSpan = { id: number; startDate: string; endDate: string; todoGroup: CalTodo[] };

export function MonthGrid({ month, today, events, emails = [], planned = [], todos = [], approvals, onOpen, onOpenEmail, onOpenPlanned, onMovePlanned, onOpenTodo, onAddOn, onDatesChange }: {
  /** Any ISO day in the month shown. */
  month: string;
  today: string;
  /** Phases, events and notes (a note is a one-day event of type "note"). */
  events: CalEvent[];
  /** To-dos shown on their day. */
  todos?: CalTodo[];
  onOpenTodo?: (t: CalTodo) => void;
  /** Klaviyo sends — read-only, tap to see the subject line. */
  emails?: KlaviyoEmail[];
  onOpen: (e: CalEvent) => void;
  onOpenEmail?: (m: KlaviyoEmail) => void;
  /** Our planned emails — draggable to another day. */
  planned?: PlannedEmail[];
  /** Approval status (dots on the chips; everyone sees it). */
  approvals?: ApprovalIndex;
  onOpenPlanned?: (e: PlannedEmail) => void;
  onMovePlanned?: (e: PlannedEmail, sendDate: string) => void;
  onAddOn: (date: string) => void;
  onDatesChange: (e: CalEvent, next: { startDate: string; endDate: string }, mode: DragMode) => void;
}) {
  const weeks = useMemo(() => monthGridWeeks(month), [month]);
  const monthKey = month.slice(0, 7);
  const { start, spanOf, dragging, justDragged } = useSpanDrag<CalEvent>({
    dateAt: dateFromElementsAt,
    onCommit: onDatesChange,
    onTap: onOpen,
  });
  const planDrag = useSpanDrag<PlanDrag>({
    dateAt: dateFromElementsAt,
    onCommit: (d, next) => onMovePlanned?.(d.email, next.startDate),
    onTap: d => onOpenPlanned?.(d.email),
  });
  const shown = events.map(spanOf);
  // Klaviyo sends already linked to a plan show as the plan's chip instead.
  const linked = useMemo(() => new Set(planned.map(p => p.klaviyoCampaignId).filter(Boolean)), [planned]);
  // Negative ids can never clash with real event ids.
  const emailSpans: EmailSpan[] = useMemo(
    () => emails.filter(m => !linked.has(m.id)).map((m, i) => ({ id: -(i + 1), startDate: m.date, endDate: m.date, email: m })),
    [emails, linked],
  );
  const planSpans: PlanSpan[] = planned.map(p => {
    const d = planDrag.spanOf<PlanDrag>({ id: p.id, startDate: p.sendDate, endDate: p.sendDate, email: p });
    return { id: -(1_000_000 + p.id), startDate: d.startDate, endDate: d.endDate, plan: d };
  });
  const todoSpans: Array<TodoSpan | TodoGroupSpan> = groupTodosByDay(todos).map(item => item.kind === "one"
    ? { id: -(2_000_000 + item.todo.id), startDate: item.date, endDate: item.date, todo: item.todo }
    : { id: -(3_000_000 + Number(item.date.replace(/-/g, "")) % 1_000_000), startDate: item.date, endDate: item.date, todoGroup: item.todos });
  const [openGroup, setOpenGroup] = useState<{ date: string; todos: CalTodo[] } | null>(null);

  // Test-box deadlines, drawn as markers on their days.
  const milestonesByDay = useMemo(() => {
    const m = new Map<string, Array<Milestone & { event: CalEvent }>>();
    for (const e of events) for (const ms of e.testBox?.milestones ?? []) {
      const list = m.get(ms.date) ?? [];
      list.push({ ...ms, event: e });
      m.set(ms.date, list);
    }
    return m;
  }, [events]);

  return (
    <div data-no-swipe="" className={cn("select-none", (dragging || planDrag.dragging) && "cursor-grabbing")}>
      <div className="grid grid-cols-7 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {DAY_NAMES.map(d => <div key={d} className="px-1.5 pb-1.5">{d}</div>)}
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        {weeks.map(week => {
          const { segments, laneCount } = layoutWeek<CalEvent | EmailSpan | PlanSpan | TodoSpan | TodoGroupSpan>(week, [...shown, ...planSpans, ...emailSpans, ...todoSpans]);
          // A lane holding only phases is a thin band; everything else full height.
          const thinLane = Array.from({ length: laneCount }, (_, l) => {
            const inLane = segments.filter(s => s.lane === l);
            return inLane.length > 0 && inLane.every(s => !("plan" in s.event) && !("email" in s.event) && !("todo" in s.event) && !("todoGroup" in s.event) && THIN_TYPES.has((s.event as CalEvent).type));
          });
          const laneH = (l: number) => (thinLane[l] ? THIN_PX : BAR_PX);
          const laneTop = (l: number) => Array.from({ length: l }, (_, i) => laneH(i) + GAP_PX).reduce((a, b) => a + b, 0);
          const lanesPx = laneTop(laneCount);
          const height = HEADER_PX + Math.max(lanesPx, 2 * (BAR_PX + GAP_PX)) + 8;
          return (
            <div key={week[0]} className="relative border-b border-border last:border-b-0" style={{ height }}>
              {/* Day cells: tap an empty day to add an event there. */}
              <div className="absolute inset-0 grid grid-cols-7">
                {week.map(day => {
                  const inMonth = day.slice(0, 7) === monthKey;
                  const isToday = day === today;
                  const marks = milestonesByDay.get(day) ?? [];
                  return (
                    <button
                      key={day}
                      type="button"
                      data-cal-date={day}
                      onClick={() => { if (!justDragged() && !planDrag.justDragged()) onAddOn(day); }}
                      aria-label={`Add a phase, email or note on ${day}`}
                      className={cn(
                        "relative flex flex-col items-start justify-start text-left border-r border-border last:border-r-0 px-1.5 pt-1 hover:bg-secondary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        !inMonth && "bg-secondary/30",
                      )}
                    >
                      <span className={cn(
                        "inline-flex items-center justify-center min-w-6 h-6 rounded-full text-sm font-semibold",
                        isToday ? "bg-primary text-primary-foreground px-1.5" : inMonth ? "text-foreground" : "text-muted-foreground/60",
                      )}>
                        {Number(day.slice(8, 10))}
                      </span>
                      {marks.length > 0 && (
                        <span className="absolute top-1.5 right-1 flex gap-0.5" title={marks.map(mk => `${mk.event.testBox?.name ?? mk.event.title}: ${mk.label}`).join("\n")}>
                          {marks.slice(0, 3).map((mk, i) => (
                            <span key={i} className="w-2.5 h-2.5 rotate-45 bg-rose-600 ring-1 ring-background" />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Bars. The layer ignores taps so empty days stay tappable. */}
              <div className="absolute inset-x-0 pointer-events-none" style={{ top: HEADER_PX }}>
                {segments.map(seg => {
                  if ("plan" in seg.event) {
                    const d = seg.event.plan;
                    const p = d.email;
                    const isLinked = !!p.klaviyoCampaignId;
                    const ap = approvals?.forPlan(p.id) ?? null;
                    return (
                      <div
                        key={`plan-${p.id}`}
                        role="button"
                        tabIndex={0}
                        onPointerDown={ev => planDrag.start(ev, d, "move")}
                        onKeyDown={ev => { if (ev.key === "Enter") onOpenPlanned?.(p); }}
                        title={`Planned email: “${p.subject}”${p.campaignTitle ? ` · ${p.campaignTitle}` : ""}${isLinked ? " · linked to Klaviyo" : ""}${approvalTitle(ap, ap ? approvals?.row(ap.key) ?? null : null)} — drag to another day`}
                        className="absolute pointer-events-auto touch-none cursor-grab flex items-center gap-1.5 rounded-lg px-1.5 text-xs font-semibold overflow-hidden shadow-sm bg-indigo-600 text-white"
                        style={{
                          left: `calc(${(seg.startCol / 7) * 100}% + 3px)`,
                          width: `calc(${(1 / 7) * 100}% - 6px)`,
                          top: laneTop(seg.lane),
                          height: laneH(seg.lane),
                        }}
                      >
                        {isLinked ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <MailPlus className="w-3.5 h-3.5 flex-shrink-0" />}
                        <span className="truncate flex-1">{p.subject}</span>
                        <ApprovalDot item={ap} />
                      </div>
                    );
                  }
                  if ("email" in seg.event) {
                    const m = seg.event.email;
                    const ap = approvals?.forKlaviyo(m.id) ?? null;
                    // An unlinked Klaviyo draft (2026-10-09): dashed violet,
                    // on its placeholder day, opening the Klaviyo email card.
                    if (m.status === "Draft") {
                      return (
                        <button
                          key={`email-${m.id}`}
                          type="button"
                          onClick={() => onOpenEmail?.(m)}
                          title={`Klaviyo draft (not scheduled): ${m.name}${m.subject ? ` — “${m.subject}”` : ""} · not linked to a planned email${approvalTitle(ap, ap ? approvals?.row(ap.key) ?? null : null)}`}
                          className={cn("absolute pointer-events-auto flex items-center gap-1 rounded-lg px-1.5 text-xs font-semibold overflow-hidden", KLAVIYO_DRAFT_TONE.chip)}
                          style={{
                            left: `calc(${(seg.startCol / 7) * 100}% + 3px)`,
                            width: `calc(${(1 / 7) * 100}% - 6px)`,
                            top: laneTop(seg.lane),
                            height: laneH(seg.lane),
                          }}
                        >
                          <PencilLine className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate flex-1 text-left"><span className="font-bold">Klaviyo draft:</span> {m.name}</span>
                          <ApprovalDot item={ap} onLight />
                        </button>
                      );
                    }
                    return (
                      <button
                        key={`email-${m.id}`}
                        type="button"
                        onClick={() => onOpenEmail?.(m)}
                        title={`${m.name}${m.subject ? ` — “${m.subject}”` : ""} · ${m.status}${approvalTitle(ap, ap ? approvals?.row(ap.key) ?? null : null)}`}
                        className={cn(
                          "absolute pointer-events-auto flex items-center gap-1.5 rounded-lg px-1.5 text-xs font-semibold overflow-hidden",
                          m.status === "Sent" ? KLAVIYO_TONE.sent : cn(KLAVIYO_TONE.solid, "shadow-sm"),
                        )}
                        style={{
                          left: `calc(${(seg.startCol / 7) * 100}% + 3px)`,
                          width: `calc(${(1 / 7) * 100}% - 6px)`,
                          top: laneTop(seg.lane),
                          height: laneH(seg.lane),
                        }}
                      >
                        <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate flex-1 text-left">{m.subject ?? m.name}</span>
                        <ApprovalDot item={ap} onLight={m.status === "Sent"} />
                      </button>
                    );
                  }
                  if ("todoGroup" in seg.event) {
                    const list = seg.event.todoGroup;
                    const date = seg.event.startDate;
                    return (
                      <button
                        key={`todo-group-${date}`}
                        type="button"
                        onClick={() => setOpenGroup({ date, todos: list })}
                        title={list.map(t => `${t.done ? "✓" : "•"} ${t.title}`).join("\n")}
                        className={cn("absolute pointer-events-auto flex items-center gap-1 rounded-lg px-1.5 text-xs font-semibold overflow-hidden", TODO_TONE.chip)}
                        style={{
                          left: `calc(${(seg.startCol / 7) * 100}% + 3px)`,
                          width: `calc(${(1 / 7) * 100}% - 6px)`,
                          top: laneTop(seg.lane),
                          height: laneH(seg.lane),
                        }}
                      >
                        <ListTodo className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate flex-1 text-left">{todoGroupLabel(list)}</span>
                      </button>
                    );
                  }
                  if ("todo" in seg.event) {
                    const t = seg.event.todo;
                    return (
                      <button
                        key={`todo-${t.id}`}
                        type="button"
                        onClick={() => onOpenTodo?.(t)}
                        title={`To-do${t.mine ? "" : ` (${t.assignee.name})`}: ${t.title} · ${t.dateKind === "due" ? "due" : "scheduled"} this day${t.done ? " · done" : ""}`}
                        className={cn(
                          "absolute pointer-events-auto flex items-center gap-1 rounded-lg px-1.5 text-xs font-medium overflow-hidden",
                          t.done ? TODO_TONE.done : TODO_TONE.chip,
                        )}
                        style={{
                          left: `calc(${(seg.startCol / 7) * 100}% + 3px)`,
                          width: `calc(${(1 / 7) * 100}% - 6px)`,
                          top: laneTop(seg.lane),
                          height: laneH(seg.lane),
                        }}
                      >
                        {t.done ? <CheckSquare className="w-3.5 h-3.5 flex-shrink-0" /> : <Square className="w-3.5 h-3.5 flex-shrink-0" />}
                        {!t.mine && <span className="flex-shrink-0 rounded bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900 px-1 text-[10px] font-bold no-underline">{initials(t.assignee.name)}</span>}
                        <span className="truncate flex-1 text-left">{t.title}</span>
                      </button>
                    );
                  }
                  const e = seg.event;
                  if (isNoteEvent(e)) {
                    return (
                      <div
                        key={`note-${e.id}`}
                        role="button"
                        tabIndex={0}
                        onPointerDown={ev => start(ev, e, "move")}
                        onKeyDown={ev => { if (ev.key === "Enter") onOpen(e); }}
                        title={`Note: ${e.title}${e.notes ? ` — ${e.notes.slice(0, 120)}` : ""}${e.createdBy ? ` · added by ${firstName(e.createdBy.name)}` : ""} — drag to another day`}
                        className={cn("absolute pointer-events-auto touch-none cursor-grab flex items-center gap-1 rounded-md px-1.5 text-xs font-medium overflow-hidden", NOTE_TONE.chip)}
                        style={{
                          left: `calc(${(seg.startCol / 7) * 100}% + 3px)`,
                          width: `calc(${(1 / 7) * 100}% - 6px)`,
                          top: laneTop(seg.lane),
                          height: laneH(seg.lane),
                        }}
                      >
                        <StickyNote className={cn("w-3.5 h-3.5 flex-shrink-0", NOTE_TONE.icon)} />
                        <span className="truncate flex-1">{e.title}</span>
                      </div>
                    );
                  }
                  const style = typeStyle(e.type);
                  const fixedDates = e.testBox != null;
                  const thin = THIN_TYPES.has(e.type);
                  return (
                    <div
                      key={`${e.id}-${week[0]}`}
                      role="button"
                      tabIndex={0}
                      onPointerDown={ev => start(ev, e, "move")}
                      onKeyDown={ev => { if (ev.key === "Enter") onOpen(e); }}
                      title={`${e.title}${e.createdBy ? ` · added by ${firstName(e.createdBy.name)}` : ""}${e.updatedBy ? ` · last edited by ${firstName(e.updatedBy.name)}` : ""}`}
                      className={cn(
                        "absolute pointer-events-auto touch-none cursor-grab flex items-center font-semibold overflow-hidden",
                        thin ? "text-xs" : "text-sm shadow-sm",
                        style.bar,
                        seg.continuesBefore ? "rounded-l-none" : "rounded-l-lg",
                        seg.continuesAfter ? "rounded-r-none" : "rounded-r-lg",
                        e.status === "idea" && (thin ? "border-dashed" : "opacity-70 outline-dashed outline-2 -outline-offset-2 outline-white/80"),
                        e.status === "done" && "opacity-50",
                      )}
                      style={{
                        left: `calc(${(seg.startCol / 7) * 100}% + ${seg.continuesBefore ? 0 : 3}px)`,
                        width: `calc(${((seg.endCol - seg.startCol + 1) / 7) * 100}% - ${(seg.continuesBefore ? 0 : 3) + (seg.continuesAfter ? 0 : 3)}px)`,
                        top: laneTop(seg.lane),
                        height: laneH(seg.lane),
                      }}
                    >
                      {!seg.continuesBefore && !fixedDates && seg.endCol > seg.startCol && (
                        <span
                          onPointerDown={ev => start(ev, e, "resize-start")}
                          className="absolute left-0 inset-y-0 w-3 cursor-ew-resize touch-none"
                          aria-hidden
                        />
                      )}
                      <span className="truncate px-2">{seg.continuesBefore ? "… " : ""}{e.title}</span>
                      {!seg.continuesAfter && !fixedDates && (
                        <span
                          onPointerDown={ev => start(ev, e, "resize-end")}
                          className="absolute right-0 inset-y-0 w-4 cursor-ew-resize touch-none flex items-center justify-center"
                          aria-label="Drag to change the end date"
                        >
                          <span className={cn("w-1 rounded-full", thin ? "h-3 bg-current opacity-40" : "h-4 bg-white/70")} />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* A busy day's to-dos, opened from its "N to-dos" chip. */}
      <Dialog open={openGroup != null} onOpenChange={v => { if (!v) setOpenGroup(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[92dvh] overflow-y-auto bg-card border-border rounded-2xl p-5">
          <DialogHeader>
            <DialogTitle className="font-display text-xl pr-6">
              To-dos · {openGroup ? format(parseISO(openGroup.date), "EEE d MMM") : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {openGroup?.todos.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setOpenGroup(null); onOpenTodo?.(t); }}
                className={cn("w-full min-h-12 rounded-xl px-3 py-2 flex items-center gap-2 text-left text-base", t.done ? TODO_TONE.done : TODO_TONE.chip)}
              >
                {t.done ? <CheckSquare className="w-5 h-5 flex-shrink-0" /> : <Square className="w-5 h-5 flex-shrink-0" />}
                {!t.mine && <span className="flex-shrink-0 rounded bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900 px-1.5 text-xs font-bold">{initials(t.assignee.name)}</span>}
                <span className="flex-1 min-w-0">{t.title}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
