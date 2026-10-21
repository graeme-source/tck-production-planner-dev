/**
 * LIST view of the marketing calendar — the default (Graeme, 2026-10-20):
 * "ONE continuous chronological order … emails shown only ONCE … I should
 * clearly see where we are today, what's coming up, and whether or not each
 * one has been approved — on the calendar itself." Objective I.
 *
 * Weeks top to bottom, a row per day that has something on it, a thin
 * "quiet" line for runs of empty days. Phases start and end in the flow and
 * every row they cover carries their coloured stripe and name. Each Klaviyo
 * email sits once on its send day with its status and, for approvers, an
 * Approve button right on the row. Today is ONE highlighted row — the
 * Today bar with today's phases and emails directly under it — and the
 * page opens scrolled to it. There is no inner scroll box (Graeme,
 * 2026-10-21): the list flows in the page and the page scrolls, with the
 * week headings sticking under the top bar. Drafts with no send date
 * are not here: they have their own collapsible section above the list
 * (drafts-section.tsx, Graeme 2026-10-21). The ordering is buildAgenda() in
 * @workspace/marketing-calendar — tested there.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { format, parseISO } from "date-fns";
import { BadgeCheck, ChevronDown, ChevronUp, Flag, Loader2, Mail, PencilLine, Play, Tag, Users } from "lucide-react";
import {
  buildAgenda, customerGroupChip, emailRowStatus, formatRange, rowWantsApproval, type AgendaRow, type EmailRowStatus, type PhaseOnRow,
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
  const { rows, laneCount } = useMemo(
    () => buildAgenda<Phase, CalEmail>({ from, to, today, phases, emails }),
    [from, to, today, phases, emails],
  );

  // The list flows in the page and the PAGE scrolls (Graeme, 2026-10-21:
  // "Get rid of having to scroll in the container of the calendar … I want
  // to see the whole thing by scrolling down the page"). So every scroll
  // below moves the app's main scroll area, not a box of our own.
  const box = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  const scrolledOnce = useRef(false);
  // "Show earlier" adds rows above: keep what was on screen where it was.
  const anchor = useRef<{ key: string; offset: number } | null>(null);

  const scrollToToday = (smooth: boolean) => {
    const t = todayRef.current;
    if (!t) return;
    // Leave room for the sticky week heading, and show a sliver of the past.
    pageScroller().scrollBy({ top: topInScroller(t) - 56, behavior: smooth ? "smooth" : "auto" });
  };

  useLayoutEffect(() => {
    if (!scrolledOnce.current && settled && !loading) {
      scrolledOnce.current = true;
      scrollToToday(false);
    }
  });
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
    onEarlier();
  };

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 z-20 flex items-start justify-center pt-24 bg-card/60"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      )}
      <div ref={box} className="relative rounded-xl border border-border bg-background">
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
    <div className="flex gap-0.5 self-stretch flex-shrink-0 pl-1" aria-hidden>
      {Array.from({ length: laneCount }, (_, lane) => {
        const p = byLane.get(lane);
        return (
          <span key={lane} className={cn("w-1.5 rounded-full", p ? PHASE_CLS.stripe : "bg-transparent")}
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
      <div className={cn("px-3 py-2 border-b border-border flex items-center gap-2 backdrop-blur",
        r.current ? "bg-primary/10" : "bg-secondary/90")}>
        <h3 className="text-sm font-bold">Week of {day(r.weekStart, "EEE d MMM")}</h3>
        {r.current && <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-primary text-primary-foreground">This week</span>}
      </div>
    );
  }

  if (r.kind === "quiet") {
    const names = r.phases.map(p => p.phase.title).join(" · ");
    return (
      <div className={cn("flex items-stretch gap-2 min-h-7 border-b border-border/60", r.isPast && "opacity-60")}>
        <Stripes phases={r.phases} laneCount={laneCount} />
        <p className="flex-1 py-1 pr-3 text-xs text-muted-foreground flex flex-wrap items-center gap-x-2">
          <span>Quiet · {r.days === 1 ? day(r.from, "EEE d MMM") : `${day(r.from, "EEE d")} – ${day(r.to, "EEE d MMM")}`}</span>
          {names && <span className="font-semibold">{names}</span>}
        </p>
      </div>
    );
  }

  // A day with something on it — or today, which is ONE row: the Today bar
  // with today's phases and emails straight under it.
  const startingIds = new Set(r.starts.map(p => p.id));
  const runningOn = r.phases.filter(p => !startingIds.has(p.phase.id));
  const body = (
    <div className={cn("flex items-stretch gap-2", !r.isToday && "border-b border-border", r.isPast && "opacity-70")}>
      <Stripes phases={r.phases} laneCount={laneCount} />
      <div className={cn("flex-1 min-w-0 pr-2 sm:pr-3 flex flex-col sm:flex-row gap-1.5 sm:gap-3", r.isToday ? "pt-1 pb-3 pl-1" : "py-2.5")}>
        {!r.isToday && (
          <div className="sm:w-24 flex-shrink-0">
            <p className="text-base font-bold leading-tight">{day(r.date, "EEE d MMM")}</p>
          </div>
        )}
        <div className="flex-1 min-w-0 space-y-2">
          {r.starts.map(p => <PhaseStart key={`s${p.id}`} phase={p} onOpen={() => onOpenPhase(p)} />)}
          {runningOn.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {runningOn.map(({ phase: p }) => (
                <button key={p.id} type="button" onClick={() => onOpenPhase(p)} style={phaseVars(p.color)}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold break-words text-left", PHASE_CLS.fill)}>
                  {p.title}
                </button>
              ))}
            </div>
          )}
          {r.isToday && r.emails.length === 0 && r.starts.length === 0 && r.ends.length === 0 && (
            <p className="text-sm text-muted-foreground py-0.5">Nothing sending today.</p>
          )}
          {r.emails.map(m => <EmailRow key={m.id} email={m} canApprove={canApprove} onOpen={() => onOpenEmail(m)} />)}
          {r.ends.map(p => (
            <button key={`e${p.id}`} type="button" onClick={() => onOpenPhase(p)}
              className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground text-left">
              <Flag style={phaseVars(p.color)} className={cn("w-5 h-5 flex-shrink-0 rounded-md border p-0.5", PHASE_CLS.fill)} />
              <span className="break-words">{p.title} ends</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
  if (!r.isToday) return body;
  return (
    <div className="border-y-2 border-primary bg-primary/10">
      <div className="px-3 py-2 flex items-center gap-2 text-primary flex-wrap">
        <span className="w-3 h-3 rounded-full bg-primary ring-4 ring-primary/25" />
        <span className="text-base font-bold">Today · {day(r.date, "EEEE d MMMM")}</span>
        <span className="text-sm font-medium text-muted-foreground">— past above, coming up below</span>
      </div>
      {body}
    </div>
  );
}

function PhaseStart({ phase: p, onOpen }: { phase: Phase; onOpen: () => void }) {
  const phaseVars = usePhaseVars();
  const group = customerGroupChip(p.customerGroup);
  return (
    <button type="button" onClick={onOpen} style={phaseVars(p.color)}
      className={cn("w-full text-left rounded-xl border-2 px-3 py-2 space-y-1 hover:brightness-95", PHASE_CLS.fill)}>
      <span className="flex items-center gap-2 flex-wrap">
        <Play className="w-4 h-4 flex-shrink-0" />
        <span className="text-base font-bold break-words">{p.title} starts</span>
        <span className="text-sm font-medium opacity-80">{formatRange(p.startDate, p.endDate)}</span>
      </span>
      {(p.offers.length > 0 || group) && (
        <span className="flex flex-wrap gap-1.5">
          {p.offers.map(o => (
            <span key={o} className="inline-flex items-center gap-1 rounded-full bg-background/70 px-2.5 py-0.5 text-sm font-semibold break-words">
              <Tag className="w-3.5 h-3.5 flex-shrink-0" />{o}
            </span>
          ))}
          {group && <span className="inline-flex items-center gap-1 rounded-full bg-background/70 px-2.5 py-0.5 text-sm font-semibold"><Users className="w-3.5 h-3.5" />{group}</span>}
        </span>
      )}
    </button>
  );
}

const STATUS_PILL: Record<EmailRowStatus, string> = {
  sent: "bg-secondary text-muted-foreground border-border",
  sent_unapproved: "bg-secondary text-muted-foreground border-border",
  approved: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/40",
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
    <div className={cn("rounded-xl border-2 bg-card flex flex-wrap items-start gap-x-3 gap-y-2 p-2.5",
      rowWantsApproval(s) ? "border-amber-500/60" : s === "approved" ? "border-emerald-500/40" : "border-border")}>
      <button type="button" onClick={onOpen} className="flex-1 min-w-[12rem] text-left flex gap-2.5">
        <span className="w-14 flex-shrink-0 text-center">
          <span className={cn("block text-base font-bold tabular-nums", sent && "text-muted-foreground")}>{time ?? "—"}</span>
          <span className="flex justify-center text-teal-600">
            {m.status === "Draft" ? <PencilLine className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
          </span>
        </span>
        <span className="min-w-0 space-y-0.5">
          <span className={cn("block text-base font-semibold leading-snug break-words", sent && "text-muted-foreground")}>{m.subject ?? m.name}</span>
          {m.previewText && <span className="block text-sm text-muted-foreground break-words">{m.previewText}</span>}
          <span className="block text-xs text-muted-foreground break-words">
            {m.status === "Draft" ? "Draft in Klaviyo" : m.status}{m.subject ? ` · ${m.name}` : ""}
          </span>
        </span>
      </button>
      <div className="flex items-center gap-2 flex-wrap justify-end ml-auto">
        <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm font-semibold break-words", STATUS_PILL[s])}>
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
