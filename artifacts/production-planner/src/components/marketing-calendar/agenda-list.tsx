/**
 * LIST view of the marketing calendar — the default (Graeme, 2026-10-20):
 * "ONE continuous chronological order … emails shown only ONCE … I should
 * clearly see where we are today, what's coming up, and whether or not each
 * one has been approved — on the calendar itself." Objective I.
 *
 * Weeks top to bottom, a row per day that has something on it, a thin
 * "quiet" line (just its dates) for runs of empty days. Phases start and end
 * in the flow and every row they cover carries their coloured stripe. Each Klaviyo
 * email sits once on its send day with its status and, for approvers, an
 * Approve button right on the row. Today is a day row like the rest, its
 * date green under a slim green line, and the page opens scrolled to it. There is no inner scroll box (Graeme,
 * 2026-10-21): the list flows in the page and the page scrolls, with the
 * week headings sticking under the top bar. Drafts with no send date
 * are not here: they have their own collapsible section above the list
 * (drafts-section.tsx, Graeme 2026-10-21). The ordering is buildAgenda() in
 * @workspace/marketing-calendar — tested there.
 */
import { EmailResultsBlock } from "./email-results";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { BadgeCheck, ChevronDown, ChevronUp, Flag, Loader2, Mail, PencilLine, Play, Tag, Users } from "lucide-react";
import {
  buildAgenda, customerGroupChip, emailRowStatus, formatRange, rowWantsApproval, startAtLastSent, type AgendaRow, type EmailRowStatus, type PhaseOnRow,
} from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import { appScrollContainer } from "@/lib/scroll";
import type { CalEmail, Phase } from "./api";
import { ApproveButton } from "./email-panel";
import { PHASE_CLS, usePhaseVars } from "./constants";

type Row = AgendaRow<Phase, CalEmail>;

// Every phase is drawn in its own colour (Graeme, 2026-10-21) — stripe,
// start banner, running chip and end flag alike. Overlapping phases keep
// separate lanes, so two in the same colour still show as two stripes.

const day = (iso: string, f: string) => format(parseISO(iso), f);
const ROW_SELECTOR = '[data-row-key]:not([data-row-key^="week-"])';

/** The page's scroll area: the app's main content (sidebar pages), else the window. */
function pageScroller(): HTMLElement {
  return appScrollContainer() ?? (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** Where an element sits from the top edge of the visible page area, in px. */
function topInScroller(el: HTMLElement): number {
  const s = appScrollContainer();
  const edge = s ? s.getBoundingClientRect().top : 0;
  return el.getBoundingClientRect().top - edge;
}

export function AgendaList({
  from, to, today, phases, emails, canApprove, loading, settled, onOpenPhase, onOpenEmail, onEarlier, onLater, scrollToTodaySignal,
}: {
  from: string;
  to: string;
  today: string;
  phases: Phase[];
  emails: CalEmail[];
  canApprove: boolean;
  loading: boolean;
  /** Data for the current range has arrived (not the previous range's placeholder). */
  settled: boolean;
  onOpenPhase: (p: Phase) => void;
  onOpenEmail: (m: CalEmail) => void;
  onEarlier: () => void;
  onLater: () => void;
  /** Bumped by the Today button to scroll back to today. */
  scrollToTodaySignal: number;
}) {
  const agenda = useMemo(
    () => buildAgenda<Phase, CalEmail>({ from, to, today, phases, emails }),
    [from, to, today, phases, emails],
  );
  // Opens at the last email sent, then today (Graeme, 11 Nov 2026); the
  // first "Show earlier" unfolds the rest of what's loaded, later presses
  // load more weeks as before.
  const [showAll, setShowAll] = useState(false);
  const recent = useMemo(() => startAtLastSent(agenda.rows, today), [agenda.rows, today]);
  const rows = showAll ? agenda.rows : recent.rows;
  const laneCount = agenda.laneCount;

  // The list flows in the page and the PAGE scrolls (Graeme, 2026-10-21:
  // "Get rid of having to scroll in the container of the calendar … I want
  // to see the whole thing by scrolling down the page"). So every scroll
  // below moves the app's main scroll area, not a box of our own.
  const box = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  // "Show earlier" adds rows above: keep what was on screen where it was.
  const anchor = useRef<{ key: string; offset: number } | null>(null);

  const scrollToToday = (smooth: boolean) => {
    const t = todayRef.current;
    if (!t) return;
    // Leave room for the sticky week heading, and show a sliver of the past.
    pageScroller().scrollBy({ top: topInScroller(t) - 56, behavior: smooth ? "smooth" : "auto" });
  };

  // No jump to today on load (Graeme, 20 Nov 2026: "I'd rather just see the
  // stuff at the top"). The Today button still scrolls here.
  useEffect(() => { if (scrollToTodaySignal > 0) scrollToToday(true); }, [scrollToTodaySignal]);

  useLayoutEffect(() => {
    const a = anchor.current, b = box.current;
    if (!a || !b) return;
    const el = b.querySelector<HTMLElement>(`[data-row-key="${a.key}"]`);
    if (el) pageScroller().scrollTop += topInScroller(el) - a.offset;
    if (settled) anchor.current = null;
  });

  const showEarlier = () => {
    const b = box.current;
    if (b) {
      // The first row at or below the top of the page area is the one to
      // hold still. (Not a week heading: a sticky element reports where it
      // is stuck.) If the list is scrolled out of view, the first row.
      const rowsEls = Array.from(b.querySelectorAll<HTMLElement>(ROW_SELECTOR));
      const first = rowsEls.find(el => topInScroller(el) + el.offsetHeight > 0) ?? rowsEls[0];
      if (first) anchor.current = { key: first.dataset.rowKey!, offset: topInScroller(first) };
    }
    if (!showAll && recent.hidden) setShowAll(true);
    else onEarlier();
  };

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 z-20 flex items-start justify-center pt-24 bg-card/60"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      )}
      <div ref={box} className="relative rounded-2xl border border-border bg-card">
        <div className="p-2 border-b border-border">
          <button type="button" onClick={showEarlier}
            className="w-full h-11 rounded-xl border-2 border-dashed border-border text-sm font-semibold text-muted-foreground flex items-center justify-center gap-1.5 hover:bg-secondary/40">
            <ChevronUp className="w-4 h-4" /> Show earlier
          </button>
        </div>

        {rows.map(r => (
          <div key={r.key} data-row-key={r.key} ref={r.kind === "day" && r.isToday ? todayRef : undefined}
            // Sticks flush under the top bar: the page area has p-4 / md:p-8
            // padding, and a plain top-0 would stick below it with rows
            // showing through the gap.
            className={r.kind === "week" ? "sticky -top-4 md:-top-8 z-10" : undefined}>
            <AgendaRowView row={r} laneCount={laneCount} canApprove={canApprove} onOpenPhase={onOpenPhase} onOpenEmail={onOpenEmail} />
          </div>
        ))}

        <div className="p-2 border-t border-border">
          <button type="button" onClick={onLater}
            className="w-full h-11 rounded-xl border-2 border-dashed border-border text-sm font-semibold text-muted-foreground flex items-center justify-center gap-1.5 hover:bg-secondary/40">
            <ChevronDown className="w-4 h-4" /> Show later
          </button>
        </div>
      </div>
    </div>
  );
}

/** One thin coloured column per lane, filled where that lane's phase covers the row. */
function Stripes({ phases, laneCount }: { phases: PhaseOnRow<Phase>[]; laneCount: number }) {
  const phaseVars = usePhaseVars();
  if (laneCount === 0) return null;
  const byLane = new Map(phases.map(p => [p.lane, p.phase]));
  return (
    <div className="flex gap-0.5 self-stretch flex-shrink-0 pl-1.5" aria-hidden>
      {Array.from({ length: laneCount }, (_, lane) => {
        const p = byLane.get(lane);
        return (
          <span key={lane} className={cn("w-1 rounded-full", p ? cn(PHASE_CLS.stripe, "opacity-70") : "bg-transparent")}
            style={p ? phaseVars(p.color) : undefined} />
        );
      })}
    </div>
  );
}

function AgendaRowView({ row: r, laneCount, canApprove, onOpenPhase, onOpenEmail }: {
  row: Row; laneCount: number; canApprove: boolean;
  onOpenPhase: (p: Phase) => void; onOpenEmail: (m: CalEmail) => void;
}) {
  const phaseVars = usePhaseVars();
  if (r.kind === "week") {
    return (
      <div className="px-4 pt-4 pb-1.5 border-b border-border bg-card/95 backdrop-blur flex items-baseline gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Week of {day(r.weekStart, "EEE d MMM")}</h3>
        {r.current && <span className="text-xs font-bold uppercase tracking-wide text-primary">This week</span>}
      </div>
    );
  }

  if (r.kind === "quiet") {
    // No words (Graeme, 18 Nov 2026: "the lack of an email visually should
    // tell us that") — just the dates, where every day's date sits.
    return (
      <div className={cn("flex items-stretch gap-2 min-h-7 border-b border-border/50", r.isPast && "opacity-60")}>
        <Stripes phases={r.phases} laneCount={laneCount} />
        <p className="flex-1 py-1 pr-3 text-xs text-muted-foreground/80 flex items-center">
          {r.days === 1 ? day(r.from, "EEE d MMM") : `${day(r.from, "EEE d")} – ${day(r.to, "EEE d MMM")}`}
        </p>
      </div>
    );
  }

  // A day with something on it. Today is the same row as every other day —
  // date in the date column (green), emails the same size and indent — under
  // a slim green line (Graeme, 18 Nov 2026). Running phases aren't named on
  // each day: the coloured stripe on the left shows them.
  return (
    <div className={cn("relative flex items-stretch gap-2 border-b border-border/70", r.isPast && "opacity-70", r.isToday && "border-t-2 border-t-primary/70")}>
      <Stripes phases={r.phases} laneCount={laneCount} />
      <div className="flex-1 min-w-0 pr-2 sm:pr-3 py-3 flex flex-col sm:flex-row gap-1.5 sm:gap-3">
        <div className={cn("sm:w-24 flex-shrink-0", r.isToday && "text-primary")}>
          <p className="text-sm font-semibold leading-tight">{r.isToday ? "Today" : day(r.date, "EEE")}</p>
          <p className="text-base font-bold leading-tight">{day(r.date, "d MMM")}</p>
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          {r.starts.map(p => <PhaseStart key={`s${p.id}`} phase={p} onOpen={() => onOpenPhase(p)} />)}
          {r.emails.map(m => <EmailRow key={m.id} email={m} canApprove={canApprove} onOpen={() => onOpenEmail(m)} />)}
          {r.ends.map(p => (
            <button key={`e${p.id}`} type="button" onClick={() => onOpenPhase(p)}
              className="flex items-center gap-1.5 min-h-8 text-sm text-muted-foreground hover:text-foreground text-left">
              <Flag style={phaseVars(p.color)} className={cn("w-4 h-4 flex-shrink-0", PHASE_CLS.text)} />
              <span className="break-words">{p.title} ends</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PhaseStart({ phase: p, onOpen }: { phase: Phase; onOpen: () => void }) {
  const phaseVars = usePhaseVars();
  const group = customerGroupChip(p.customerGroup);
  return (
    <button type="button" onClick={onOpen}
      className="w-full min-h-11 text-left rounded-xl px-1 py-1 space-y-1 hover:bg-secondary/40">
      {/* Bar and icon stay beside the title however it wraps. */}
      <span className="flex items-start gap-2">
        <span style={phaseVars(p.color)} className={cn("w-1 h-5 mt-0.5 rounded-full flex-shrink-0", PHASE_CLS.stripe)} />
        <Play className="w-3.5 h-3.5 mt-1 flex-shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="text-base font-bold break-words">{p.title} starts</span>
          <span className="text-sm text-muted-foreground"> · {formatRange(p.startDate, p.endDate)}</span>
        </span>
      </span>
      {(p.offers.length > 0 || group) && (
        <span className="flex flex-wrap gap-1.5 pl-3">
          {p.offers.map(o => (
            <span key={o} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground break-words">
              <Tag className="w-3 h-3 flex-shrink-0" />{o}
            </span>
          ))}
          {group && <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground"><Users className="w-3 h-3" />{group}</span>}
        </span>
      )}
    </button>
  );
}

// One strong colour on the list (Graeme, 18 Nov 2026: "so many different
// colour blocks"): amber for what needs acting on. Approved and sent read as
// plain text with a small tick.
const STATUS_PILL: Record<EmailRowStatus, string> = {
  sent: "border-transparent text-muted-foreground",
  sent_unapproved: "border-transparent text-muted-foreground",
  approved: "border-transparent text-muted-foreground",
  changed: "bg-amber-500/15 text-amber-900 dark:text-amber-200 border-amber-500/50",
  needs_approval: "bg-amber-500/15 text-amber-900 dark:text-amber-200 border-amber-500/50",
};

function statusWords(m: CalEmail, s: EmailRowStatus): string {
  const who = m.approval.approvedBy?.trim().split(/\s+/)[0];
  switch (s) {
    case "sent": return "Sent";
    case "sent_unapproved": return "Sent without approval";
    case "approved": return who ? `Approved by ${who}` : "Approved";
    case "changed": return `Changed since approval — ${m.approval.changed.join(", ")}`;
    case "needs_approval": return "Needs approval";
  }
}

export function EmailRow({ email: m, canApprove, onOpen }: { email: CalEmail; canApprove: boolean; onOpen: () => void }) {
  const s = emailRowStatus(m);
  const sent = s === "sent" || s === "sent_unapproved";
  const time = m.sendAt ? format(parseISO(m.sendAt), "HH:mm") : null;
  return (
    <div className={cn("rounded-xl border bg-card flex flex-wrap items-start gap-x-3 gap-y-2 p-2.5 shadow-sm",
      rowWantsApproval(s) ? "border-amber-500/50 border-l-4 border-l-amber-500" : "border-border")}>
      <button type="button" onClick={onOpen} className="flex-1 min-w-[12rem] text-left flex gap-2.5">
        <span className="w-14 flex-shrink-0 text-center">
          <span className={cn("block text-base font-bold tabular-nums", sent && "text-muted-foreground")}>{time ?? "—"}</span>
          <span className="flex justify-center text-muted-foreground">
            {m.status === "Draft" ? <PencilLine className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
          </span>
        </span>
        <span className="min-w-0 space-y-0.5">
          <span className={cn("block text-base font-semibold leading-snug break-words", sent && "text-muted-foreground")}>{m.subject ?? m.name}</span>
          {m.previewText && <span className="block text-sm text-muted-foreground break-words">{m.previewText}</span>}
          <span className="block text-xs text-muted-foreground break-words">
            {m.status === "Draft" ? "Draft in Klaviyo" : m.status}{m.subject ? ` · ${m.name}` : ""}
          </span>
          {m.results && <span className="block pt-1.5"><EmailResultsBlock r={m.results} compact /></span>}
        </span>
      </button>
      <div className="flex items-center gap-2 flex-wrap justify-end ml-auto">
        <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm font-medium break-words", STATUS_PILL[s])}>
          {s === "approved" || s === "sent"
            ? <BadgeCheck className={cn("w-4 h-4 flex-shrink-0", s === "approved" && "text-emerald-600")} />
            : rowWantsApproval(s) && <span className="w-2.5 h-2.5 rounded-full bg-amber-500 flex-shrink-0" />}
          {statusWords(m, s)}
        </span>
        {canApprove && rowWantsApproval(s) && (
          <ApproveButton email={m} size="small" label={s === "changed" ? "Approve again" : "Approve"} />
        )}
      </div>
    </div>
  );
}
