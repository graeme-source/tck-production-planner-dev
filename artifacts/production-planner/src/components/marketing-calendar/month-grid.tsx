/**
 * Month view (2026-10-20): Monday-start weeks, PHASES as violet bars spanning
 * their days and wrapping onto the next week, KLAVIYO EMAILS as one-day teal
 * chips on their send day. Drag a phase to move it, drag its end to stretch
 * or shrink it, tap it to edit; tap an email to see it (and approve it); tap
 * an empty day to add a phase starting there.
 *
 * Names are never cut short (Graeme's standing rule): each week is a CSS grid
 * whose rows grow to fit, so an email's full subject wraps over two or three
 * lines inside its day and a short phase bar wraps its full name.
 *
 * Email chips: a draft is dashed, scheduled solid, sent grey. A green tick =
 * Approved; an amber dot = Needs approval. Today's cell is ringed and tinted
 * green with a "Today" label. The status shows on the chip itself — there is
 * no separate approvals list (Graeme, 2026-10-20).
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
const BAR_MIN_PX = 28;
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
          const { segments } = layoutWeek<Phase | EmailSpan>(week, [...shown, ...emailSpans]);
          return (
            <div key={week[0]} className="relative border-b border-border last:border-b-0" style={{ minHeight: HEADER_PX + 2 * (BAR_MIN_PX + GAP_PX) + 8 }}>
              {/* Day cells: tap an empty day to add a phase starting there.
                  They fill the row, however tall its contents make it. */}
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
                        isToday && "bg-primary/10 ring-2 ring-inset ring-primary",
                      )}
                    >
                      <span className={cn(
                        "inline-flex items-center justify-center min-w-6 h-6 rounded-full text-sm font-semibold",
                        isToday ? "bg-primary text-primary-foreground px-1.5" : inMonth ? "text-foreground" : "text-muted-foreground/60",
                      )}>
                        {Number(day.slice(8, 10))}
                      </span>
                      {isToday && <span className="absolute top-1.5 right-1.5 text-[10px] font-bold uppercase text-primary">Today</span>}
                    </button>
                  );
                })}
              </div>

              {/* Bars and chips on a grid whose rows grow to fit the full text.
                  The layer ignores taps so empty days stay tappable. */}
              <div
                className="relative grid grid-cols-7 pointer-events-none pb-2"
                style={{ paddingTop: HEADER_PX, rowGap: GAP_PX }}
              >
                {segments.map(seg => {
                  const place = {
                    gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}`,
                    gridRow: seg.lane + 1,
                    minHeight: BAR_MIN_PX,
                  };
                  if ("email" in seg.event) {
                    const m = seg.event.email;
                    const approved = m.approval.status === "approved";
                    return (
                      <button
                        key={`email-${m.id}`}
                        type="button"
                        onClick={() => onOpenEmail(m)}
                        title={`${m.status === "Draft" ? "Klaviyo draft" : `Klaviyo · ${m.status}`}: “${m.subject ?? m.name}” · ${approved ? "Approved" : m.status === "Sent" || m.status === "Sending" ? "Sent without approval" : "Needs approval"}`}
                        className={cn(
                          "self-start pointer-events-auto mx-[3px] flex flex-col gap-0.5 rounded-lg px-1 py-1 text-[10px] lg:text-[11px] leading-tight font-semibold text-left",
                          m.status === "Draft" ? KLAVIYO_TONE.draft : m.status === "Sent" ? KLAVIYO_TONE.sent : cn(KLAVIYO_TONE.solid, "shadow-sm"),
                        )}
                        style={place}
                      >
                        {/* Icon and status on top, so the subject gets the
                            chip's full width and wraps by whole words. */}
                        <span className="flex items-center gap-1">
                          {m.status === "Draft" ? <PencilLine className="w-3 h-3 flex-shrink-0" /> : <Mail className="w-3 h-3 flex-shrink-0" />}
                          <span className="flex-1" />
                          {approved
                            ? <BadgeCheck className={cn("w-3.5 h-3.5 flex-shrink-0", m.status === "Draft" || m.status === "Sent" ? "text-emerald-600" : "text-white")} aria-label="Approved" />
                            : m.status !== "Sent" && <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-white/80 flex-shrink-0" aria-label="Needs approval" />}
                        </span>
                        <span className="break-words hyphens-auto" lang="en-GB">{m.subject ?? m.name}</span>
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
                        "relative self-start pointer-events-auto touch-none cursor-grab flex items-center gap-1.5 text-sm leading-tight font-semibold shadow-sm",
                        PHASE_TONE.bar,
                        seg.continuesBefore ? "rounded-l-none ml-0" : "rounded-l-lg ml-[3px]",
                        seg.continuesAfter ? "rounded-r-none mr-0" : "rounded-r-lg mr-[3px]",
                        p.endDate < today && "opacity-60",
                      )}
                      style={place}
                    >
                      {!seg.continuesBefore && seg.endCol > seg.startCol && (
                        <span
                          onPointerDown={ev => start(ev, p, fixedDates ? "move" : "resize-start")}
                          className={cn("absolute left-0 inset-y-0 w-3 touch-none", !fixedDates && "cursor-ew-resize")}
                          aria-hidden
                        />
                      )}
                      {/* The full name, wrapping when the bar is short — on a
                          continuing segment too, so it is never cut off. */}
                      <span className="flex-1 min-w-0 pl-2 py-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span className="break-words hyphens-auto" lang="en-GB">{seg.continuesBefore ? "… " : ""}{p.title}</span>
                        {group && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-white/25 px-1.5 text-[11px] font-bold">
                            <Users className="w-3 h-3" />{group}
                          </span>
                        )}
                      </span>
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
