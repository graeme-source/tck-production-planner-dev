/**
 * Timeline view: Gantt-style bars across weeks or months, scrolling
 * sideways. Every event gets its own lane where it would otherwise collide.
 * Same gestures as the month grid: drag to move, drag an end to stretch,
 * tap to open, tap an empty spot to add an event on that day.
 * Notes (2026-10-01) are small yellow sticky-note markers in the top strip,
 * beside that day's Klaviyo sends; tap one to open it.
 */
import { useEffect, useMemo, useRef } from "react";
import {
  addDays, addMonths, assignLanes, daysBetween, DAY_WIDTH, timelineRange, type DragMode, type TimelineZoom,
} from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import type { CalEvent, KlaviyoEmail } from "./api";
import { Mail, StickyNote } from "lucide-react";
import { typeStyle, firstName, THIN_TYPES, NOTE_TONE } from "./constants";
import { useSpanDrag } from "./use-span-drag";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LANE_PX = 46;
const BAR_PX = 38;
/** A strip along the top for Klaviyo sends, above the event lanes. */
const EMAIL_ROW_PX = 34;

export function timelineMonths(zoom: TimelineZoom): number {
  return zoom === "weeks" ? 3 : 12;
}

export function Timeline({ anchor, zoom, today, events, emails = [], notes = [], onOpen, onOpenEmail, onAddOn, onDatesChange }: {
  anchor: string;
  zoom: TimelineZoom;
  today: string;
  /** Phases and events (no notes — they go in the top strip). */
  events: CalEvent[];
  notes?: CalEvent[];
  emails?: KlaviyoEmail[];
  onOpen: (e: CalEvent) => void;
  onOpenEmail?: (m: KlaviyoEmail) => void;
  onAddOn: (date: string) => void;
  onDatesChange: (e: CalEvent, next: { startDate: string; endDate: string }, mode: DragMode) => void;
}) {
  const range = useMemo(() => timelineRange(anchor, timelineMonths(zoom)), [anchor, zoom]);
  const dw = DAY_WIDTH[zoom];
  const width = range.days * dw;
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dateAt = (clientX: number): string | null => {
    const el = trackRef.current;
    if (!el) return null;
    const x = clientX - el.getBoundingClientRect().left;
    const i = Math.max(0, Math.min(range.days - 1, Math.floor(x / dw)));
    return addDays(range.from, i);
  };

  const { start, spanOf, dragging, justDragged } = useSpanDrag<CalEvent>({
    dateAt: x => dateAt(x),
    onCommit: onDatesChange,
    onTap: onOpen,
  });

  const shown = events.map(spanOf);
  // Lanes from the saved positions, so a bar being dragged doesn't make the
  // others jump around under your finger.
  const lanes = useMemo(() => assignLanes(events), [events]);
  const laneCount = Math.max(3, events.reduce((m, e) => Math.max(m, (lanes.get(e.id) ?? 0) + 1), 0));

  // Open on today (or the start of the range when today is outside it).
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const offset = today >= range.from && today <= range.to ? daysBetween(range.from, today) * dw - 80 : 0;
    sc.scrollLeft = Math.max(0, offset);
  }, [range.from, range.to, dw, today]);

  // Header ticks: month labels always; week starts (Mondays) at the week zoom.
  const months: Array<{ left: number; label: string }> = [];
  for (let m = addMonths(range.from, range.from.endsWith("-01") ? 0 : 1); m <= range.to; m = addMonths(m, 1)) {
    const [y, mo] = m.split("-").map(Number);
    months.push({ left: daysBetween(range.from, m) * dw, label: `${MONTH_NAMES[mo - 1]} ${y}` });
  }
  const weeks: Array<{ left: number; label: string; date: string }> = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 7)) {
    weeks.push({ left: daysBetween(range.from, d) * dw, label: String(Number(d.slice(8, 10))), date: d });
  }
  const todayLeft = today >= range.from && today <= range.to ? daysBetween(range.from, today) * dw + dw / 2 : null;

  return (
    <div ref={scrollRef} className={cn("overflow-x-auto rounded-xl border border-border select-none", dragging && "cursor-grabbing")}>
      <div style={{ width }} className="relative">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-card border-b border-border">
          <div className="relative h-7">
            {months.map(m => (
              <div key={m.left} className="absolute top-0 h-full border-l border-border pl-1.5 text-sm font-semibold flex items-center whitespace-nowrap" style={{ left: m.left }}>
                {m.label}
              </div>
            ))}
          </div>
          <div className="relative h-6 text-xs text-muted-foreground">
            {weeks.map(w => (
              <div key={w.date} className="absolute top-0 h-full border-l border-border/60 pl-1 flex items-center" style={{ left: w.left }}>
                {zoom === "weeks" ? `w/c ${w.label}` : ""}
              </div>
            ))}
          </div>
        </div>

        {/* Track */}
        <div
          ref={trackRef}
          className="relative"
          style={{ height: EMAIL_ROW_PX + laneCount * LANE_PX + 12 }}
          onClick={e => { if (justDragged()) return; const d = dateAt(e.clientX); if (d) onAddOn(d); }}
        >
          {/* Week gridlines + weekend shading at the week zoom */}
          {weeks.map(w => (
            <div key={w.date} className="absolute inset-y-0 border-l border-border/50" style={{ left: w.left }}>
              {zoom === "weeks" && <div className="absolute inset-y-0 bg-secondary/40" style={{ left: 5 * dw, width: 2 * dw }} />}
            </div>
          ))}
          {/* Klaviyo sends along the top strip — read-only, tap for details. */}
          <div className="absolute inset-x-0 top-0 border-b border-dashed border-teal-500/30" style={{ height: EMAIL_ROW_PX }} />
          {emails.filter(m => m.date >= range.from && m.date <= range.to).map(m => {
            const size = Math.max(dw, 26);
            return (
              <button
                key={`email-${m.id}`}
                type="button"
                onClick={ev => { ev.stopPropagation(); onOpenEmail?.(m); }}
                title={`${m.date} · ${m.name}${m.subject ? ` — “${m.subject}”` : ""} · ${m.status}`}
                className={cn(
                  "absolute z-[3] rounded-md border-2 flex items-center justify-center",
                  m.status === "Sent" ? "border-teal-500/40 bg-teal-50 dark:bg-teal-950/40 text-teal-700/70" : "border-teal-600 bg-teal-600 text-white",
                )}
                style={{ left: daysBetween(range.from, m.date) * dw + dw / 2 - size / 2, top: 4, width: size, height: EMAIL_ROW_PX - 8 }}
              >
                <Mail className="w-3.5 h-3.5" />
              </button>
            );
          })}
          {(() => {
            // Notes sit after that day's Klaviyo sends in the strip.
            const perDay = new Map<string, number>();
            for (const m of emails) perDay.set(m.date, (perDay.get(m.date) ?? 0) + 1);
            const size = Math.max(dw, 26);
            return notes.filter(n => n.startDate >= range.from && n.startDate <= range.to).map(n => {
              const idx = perDay.get(n.startDate) ?? 0;
              perDay.set(n.startDate, idx + 1);
              return (
                <button
                  key={`note-${n.id}`}
                  type="button"
                  onClick={ev => { ev.stopPropagation(); onOpen(n); }}
                  title={`${n.startDate} · Note: ${n.title}${n.notes ? ` — ${n.notes.slice(0, 120)}` : ""}`}
                  className={cn("absolute z-[3] rounded-md flex items-center justify-center", NOTE_TONE.chip)}
                  style={{ left: daysBetween(range.from, n.startDate) * dw + dw / 2 - size / 2 + idx * (size + 2), top: 4, width: size, height: EMAIL_ROW_PX - 8 }}
                >
                  <StickyNote className={cn("w-3.5 h-3.5", NOTE_TONE.icon)} />
                </button>
              );
            });
          })()}
          {todayLeft != null && (
            <div className="absolute inset-y-0 w-0.5 bg-primary z-[1]" style={{ left: todayLeft }} title="Today" />
          )}

          {shown.map(e => {
            if (e.endDate < range.from || e.startDate > range.to) return null;
            const s = e.startDate < range.from ? range.from : e.startDate;
            const en = e.endDate > range.to ? range.to : e.endDate;
            const left = daysBetween(range.from, s) * dw;
            const w = (daysBetween(s, en) + 1) * dw;
            const style = typeStyle(e.type);
            const lane = lanes.get(e.id) ?? 0;
            const fixedDates = e.testBox != null;
            // Too narrow for grab handles (a short event at the months zoom):
            // the whole bar moves, and it is stretched from the event itself.
            const resizable = !fixedDates && w >= 56;
            const who = e.updatedBy ?? e.createdBy;
            return (
              <div key={e.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onPointerDown={ev => start(ev, e, "move")}
                  onClick={ev => ev.stopPropagation()}
                  onKeyDown={ev => { if (ev.key === "Enter") onOpen(e); }}
                  title={`${e.title}${e.createdBy ? ` · added by ${firstName(e.createdBy.name)}` : ""}${e.updatedBy ? ` · last edited by ${firstName(e.updatedBy.name)}` : ""}`}
                  className={cn(
                    "absolute z-[2] touch-none cursor-grab rounded-lg shadow-sm overflow-hidden flex flex-col justify-center px-2",
                    style.bar,
                    e.status === "idea" && "opacity-70 outline-dashed outline-2 -outline-offset-2 outline-white/80",
                    e.status === "done" && "opacity-50",
                  )}
                  style={{ left, width: Math.max(w, dw), top: EMAIL_ROW_PX + 6 + lane * LANE_PX, height: BAR_PX }}
                >
                  {resizable && (
                    <span onPointerDown={ev => start(ev, e, "resize-start")} className="absolute left-0 inset-y-0 w-3 cursor-ew-resize touch-none" aria-hidden />
                  )}
                  <span className="text-sm font-semibold truncate leading-tight">{e.title}</span>
                  {w > 110 && who && (
                    <span className="text-[11px] opacity-85 truncate leading-tight">
                      {e.updatedBy && e.createdBy && e.updatedBy.id !== e.createdBy.id
                        ? `${firstName(e.createdBy.name)} · edited by ${firstName(e.updatedBy.name)}`
                        : `by ${firstName(who.name)}`}
                    </span>
                  )}
                  {resizable && (
                    <span onPointerDown={ev => start(ev, e, "resize-end")} className="absolute right-0 inset-y-0 w-4 cursor-ew-resize touch-none flex items-center justify-center" aria-label="Drag to change the end date">
                      <span className={cn("w-1 h-5 rounded-full", THIN_TYPES.has(e.type) ? "bg-current opacity-40" : "bg-white/70")} />
                    </span>
                  )}
                </div>
                {/* Test-box deadlines as diamonds on the box's lane. */}
                {(e.testBox?.milestones ?? []).filter(m => m.date >= range.from && m.date <= range.to).map((m, i) => (
                  <span
                    key={i}
                    title={`${m.label} — ${m.date}`}
                    className="absolute z-[3] w-3 h-3 rotate-45 bg-white border-2 border-rose-700 pointer-events-auto"
                    style={{ left: daysBetween(range.from, m.date) * dw + dw / 2 - 6, top: EMAIL_ROW_PX + 6 + lane * LANE_PX + BAR_PX - 7 }}
                    onClick={ev => ev.stopPropagation()}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
