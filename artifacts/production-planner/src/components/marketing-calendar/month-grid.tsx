/**
 * Month view (2026-10-20): Monday-start weeks, PHASES as violet bars spanning
 * their days and wrapping onto the next week, KLAVIYO EMAILS as one-day teal
 * chips on their send day. Drag a phase to move it, drag its end to stretch
 * or shrink it, tap it to edit; tap an email to see it (and approve it); tap
 * an empty day to add a phase starting there.
 *
 * Email chips: a draft is dashed, scheduled solid, sent faded. A green tick =
 * Approved; an amber dot = Needs approval.
 */
import { useMemo } from "react";
import { BadgeCheck, Mail, PencilLine, Users } from "lucide-react";
import { customerGroupChip, layoutWeek, monthGridWeeks, type DragMode } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import type { CalEmail, Phase } from "./api";
import { KLAVIYO_TONE, PHASE_TONE } from "./constants";
import { dateFromElementsAt, useSpanDrag } from "./use-span-drag";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HEADER_PX = 30;
const BAR_PX = 28;
const GAP_PX = 4;

/** A Klaviyo email as a one-day span, so it takes a lane like a phase. */
type EmailSpan = { id: number; startDate: string; endDate: string; email: CalEmail };

export function MonthGrid({ month, today, phases, emails, onOpenPhase, onOpenEmail, onAddOn, onDatesChange }: {
  /** Any ISO day in the month shown. */
  month: string;
  today: string;
  phases: Phase[];
  /** Klaviyo emails with a send day. */
  emails: CalEmail[];
  onOpenPhase: (p: Phase) => void;
  onOpenEmail: (m: CalEmail) => void;
  onAddOn: (date: string) => void;
  onDatesChange: (p: Phase, next: { startDate: string; endDate: string }, mode: DragMode) => void;
}) {
  const weeks = useMemo(() => monthGridWeeks(month), [month]);
  const monthKey = month.slice(0, 7);
  const { start, spanOf, dragging, justDragged } = useSpanDrag<Phase>({
    dateAt: dateFromElementsAt,
    onCommit: onDatesChange,
    onTap: onOpenPhase,
  });
  const shown = phases.map(spanOf);
  // Negative ids can never clash with real phase ids.
  const emailSpans: EmailSpan[] = useMemo(
    () => emails.filter(m => m.date).map((m, i) => ({ id: -(i + 1), startDate: m.date!, endDate: m.date!, email: m })),
    [emails],
  );

  return (
    <div data-no-swipe="" className={cn("select-none", dragging && "cursor-grabbing")}>
      <div className="grid grid-cols-7 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {DAY_NAMES.map(d => <div key={d} className="px-1.5 pb-1.5">{d}</div>)}
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        {weeks.map(week => {
          const { segments, laneCount } = layoutWeek<Phase | EmailSpan>(week, [...shown, ...emailSpans]);
          const laneTop = (l: number) => l * (BAR_PX + GAP_PX);
          const height = HEADER_PX + Math.max(laneTop(laneCount), 2 * (BAR_PX + GAP_PX)) + 8;
          return (
            <div key={week[0]} className="relative border-b border-border last:border-b-0" style={{ height }}>
              {/* Day cells: tap an empty day to add a phase starting there. */}
              <div className="absolute inset-0 grid grid-cols-7">
                {week.map(day => {
                  const inMonth = day.slice(0, 7) === monthKey;
                  const isToday = day === today;
                  return (
                    <button
                      key={day}
                      type="button"
                      data-cal-date={day}
                      onClick={() => { if (!justDragged()) onAddOn(day); }}
                      aria-label={`Add a phase starting ${day}`}
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
                    </button>
                  );
                })}
              </div>

              {/* Bars. The layer ignores taps so empty days stay tappable. */}
              <div className="absolute inset-x-0 pointer-events-none" style={{ top: HEADER_PX }}>
                {segments.map(seg => {
                  if ("email" in seg.event) {
                    const m = seg.event.email;
                    const approved = m.approval.status === "approved";
                    return (
                      <button
                        key={`email-${m.id}`}
                        type="button"
                        onClick={() => onOpenEmail(m)}
                        title={`${m.status === "Draft" ? "Klaviyo draft" : `Klaviyo · ${m.status}`}: “${m.subject ?? m.name}” · ${approved ? "Approved" : "Needs approval"}`}
                        className={cn(
                          "absolute pointer-events-auto flex items-center gap-1 rounded-lg px-1.5 text-xs font-semibold overflow-hidden",
                          m.status === "Draft" ? KLAVIYO_TONE.draft : m.status === "Sent" ? KLAVIYO_TONE.sent : cn(KLAVIYO_TONE.solid, "shadow-sm"),
                        )}
                        style={{
                          left: `calc(${(seg.startCol / 7) * 100}% + 3px)`,
                          width: `calc(${(1 / 7) * 100}% - 6px)`,
                          top: laneTop(seg.lane),
                          height: BAR_PX,
                        }}
                      >
                        {m.status === "Draft" ? <PencilLine className="w-3.5 h-3.5 flex-shrink-0" /> : <Mail className="w-3.5 h-3.5 flex-shrink-0" />}
                        <span className="truncate flex-1 text-left">{m.subject ?? m.name}</span>
                        {approved
                          ? <BadgeCheck className={cn("w-4 h-4 flex-shrink-0", m.status === "Draft" || m.status === "Sent" ? "text-emerald-600" : "text-white")} aria-label="Approved" />
                          : m.status !== "Sent" && <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-white/80 flex-shrink-0" aria-label="Needs approval" />}
                      </button>
                    );
                  }
                  const p = seg.event;
                  const group = customerGroupChip(p.customerGroup);
                  const fixedDates = p.testBoxId != null;
                  return (
                    <div
                      key={`${p.id}-${week[0]}`}
                      role="button"
                      tabIndex={0}
                      onPointerDown={ev => start(ev, p, "move")}
                      onKeyDown={ev => { if (ev.key === "Enter") onOpenPhase(p); }}
                      title={`${p.title}${p.offers.length ? ` — ${p.offers.join(" · ")}` : ""}${group ? ` · ${group}` : ""} — drag to move, drag the end to stretch`}
                      className={cn(
                        "absolute pointer-events-auto touch-none cursor-grab flex items-center gap-1.5 text-sm font-semibold overflow-hidden shadow-sm",
                        PHASE_TONE.bar,
                        seg.continuesBefore ? "rounded-l-none" : "rounded-l-lg",
                        seg.continuesAfter ? "rounded-r-none" : "rounded-r-lg",
                        p.endDate < today && "opacity-60",
                      )}
                      style={{
                        left: `calc(${(seg.startCol / 7) * 100}% + ${seg.continuesBefore ? 0 : 3}px)`,
                        width: `calc(${((seg.endCol - seg.startCol + 1) / 7) * 100}% - ${(seg.continuesBefore ? 0 : 3) + (seg.continuesAfter ? 0 : 3)}px)`,
                        top: laneTop(seg.lane),
                        height: BAR_PX,
                      }}
                    >
                      {!seg.continuesBefore && seg.endCol > seg.startCol && (
                        <span
                          onPointerDown={ev => start(ev, p, fixedDates ? "move" : "resize-start")}
                          className={cn("absolute left-0 inset-y-0 w-3 touch-none", !fixedDates && "cursor-ew-resize")}
                          aria-hidden
                        />
                      )}
                      <span className="truncate pl-2">{seg.continuesBefore ? "… " : ""}{p.title}</span>
                      {group && (
                        <span className="flex-shrink-0 inline-flex items-center gap-0.5 rounded-full bg-white/25 px-1.5 text-[11px] font-bold">
                          <Users className="w-3 h-3" />{group}
                        </span>
                      )}
                      <span className="flex-1" />
                      {!seg.continuesAfter && !fixedDates && (
                        <span
                          onPointerDown={ev => start(ev, p, "resize-end")}
                          className="relative w-4 self-stretch cursor-ew-resize touch-none flex items-center justify-center flex-shrink-0"
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
