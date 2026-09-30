/**
 * Month view: Monday-start weeks, events as bars spanning their days and
 * wrapping onto the next week. Drag a bar to move it, drag its end to
 * stretch or shrink it, tap a bar to open it, tap an empty day to add one.
 */
import { useMemo } from "react";
import { layoutWeek, monthGridWeeks } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import type { CalEvent, KlaviyoEmail, Milestone } from "./api";
import { Mail } from "lucide-react";
import { typeStyle, firstName } from "./constants";
import { dateFromElementsAt, useSpanDrag } from "./use-span-drag";
import type { DragMode } from "@workspace/marketing-calendar";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HEADER_PX = 30;
const BAR_PX = 28;
const GAP_PX = 4;

/** A Klaviyo email as a one-day span, so it takes a lane like an event. */
type EmailSpan = { id: number; startDate: string; endDate: string; email: KlaviyoEmail };

export function MonthGrid({ month, today, events, emails = [], onOpen, onOpenEmail, onAddOn, onDatesChange }: {
  /** Any ISO day in the month shown. */
  month: string;
  today: string;
  events: CalEvent[];
  /** Klaviyo sends — read-only, tap to see the subject line. */
  emails?: KlaviyoEmail[];
  onOpen: (e: CalEvent) => void;
  onOpenEmail?: (m: KlaviyoEmail) => void;
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
  const shown = events.map(spanOf);
  // Negative ids can never clash with real event ids.
  const emailSpans: EmailSpan[] = useMemo(
    () => emails.map((m, i) => ({ id: -(i + 1), startDate: m.date, endDate: m.date, email: m })),
    [emails],
  );

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
    <div className={cn("select-none", dragging && "cursor-grabbing")}>
      <div className="grid grid-cols-7 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {DAY_NAMES.map(d => <div key={d} className="px-1.5 pb-1.5">{d}</div>)}
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        {weeks.map(week => {
          const { segments, laneCount } = layoutWeek<CalEvent | EmailSpan>(week, [...shown, ...emailSpans]);
          const height = HEADER_PX + Math.max(laneCount, 2) * (BAR_PX + GAP_PX) + 8;
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
                      onClick={() => { if (!justDragged()) onAddOn(day); }}
                      aria-label={`Add an event on ${day}`}
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
                  if ("email" in seg.event) {
                    const m = seg.event.email;
                    return (
                      <button
                        key={`email-${m.id}`}
                        type="button"
                        onClick={() => onOpenEmail?.(m)}
                        title={`${m.name}${m.subject ? ` — “${m.subject}”` : ""} · ${m.status}`}
                        className={cn(
                          "absolute pointer-events-auto flex items-center gap-1.5 rounded-lg border-2 px-1.5 text-xs font-semibold overflow-hidden",
                          m.status === "Sent"
                            ? "border-sky-500/30 bg-sky-500/5 text-sky-800/70 dark:text-sky-200/70"
                            : "border-sky-500 bg-sky-500/15 text-sky-800 dark:text-sky-200",
                        )}
                        style={{
                          left: `calc(${(seg.startCol / 7) * 100}% + 3px)`,
                          width: `calc(${(1 / 7) * 100}% - 6px)`,
                          top: seg.lane * (BAR_PX + GAP_PX),
                          height: BAR_PX,
                        }}
                      >
                        <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{m.subject ?? m.name}</span>
                      </button>
                    );
                  }
                  const e = seg.event;
                  const style = typeStyle(e.type);
                  const fixedDates = e.testBox != null;
                  return (
                    <div
                      key={`${e.id}-${week[0]}`}
                      role="button"
                      tabIndex={0}
                      onPointerDown={ev => start(ev, e, "move")}
                      onKeyDown={ev => { if (ev.key === "Enter") onOpen(e); }}
                      title={`${e.title}${e.createdBy ? ` · added by ${firstName(e.createdBy.name)}` : ""}${e.updatedBy ? ` · last edited by ${firstName(e.updatedBy.name)}` : ""}`}
                      className={cn(
                        "absolute pointer-events-auto touch-none cursor-grab flex items-center text-sm font-semibold shadow-sm overflow-hidden",
                        style.bar,
                        seg.continuesBefore ? "rounded-l-none" : "rounded-l-lg",
                        seg.continuesAfter ? "rounded-r-none" : "rounded-r-lg",
                        e.status === "idea" && "opacity-70 outline-dashed outline-2 -outline-offset-2 outline-white/80",
                        e.status === "done" && "opacity-50",
                      )}
                      style={{
                        left: `calc(${(seg.startCol / 7) * 100}% + ${seg.continuesBefore ? 0 : 3}px)`,
                        width: `calc(${((seg.endCol - seg.startCol + 1) / 7) * 100}% - ${(seg.continuesBefore ? 0 : 3) + (seg.continuesAfter ? 0 : 3)}px)`,
                        top: seg.lane * (BAR_PX + GAP_PX),
                        height: BAR_PX,
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
                          <span className="w-1 h-4 rounded-full bg-white/70" />
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
    </div>
  );
}
