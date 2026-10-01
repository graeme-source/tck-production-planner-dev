/**
 * List view (Graeme, 2026-09-30): the peak-trading spreadsheet as big cards.
 * Top to bottom in date order, grouped into campaign sections (a campaign's
 * name, dates and offer as the header; tap it to open the campaign). Each
 * planned email shows its day, subject line, offer, core message, cadence,
 * audience and the website / Meta changes at a glance. Klaviyo's real sends
 * sit in the right section as read-only cards, and a planned email linked to
 * its Klaviyo send is ONE card whose stage comes from Klaviyo.
 *
 * Stages + approvals (2026-09-30): each card shows its stage and approval
 * badge; Klaviyo drafts not linked to a plan show only here (dashed violet).
 * The "Needs approval" filter keeps just what the reminder counts.
 *
 * Notes and to-dos (2026-10-01) sit on their day inside the same sections,
 * ahead of that day's emails: a yellow sticky-note card, a slate to-do card.
 *
 * Grouping is the pure buildEmailSections() in @workspace/marketing-calendar.
 */
import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { BadgeCheck, CheckCircle2, CheckSquare, Globe, Mail, Megaphone, MessageSquare, Plus, Repeat, Square, StickyNote, Target, Users } from "lucide-react";
import { audienceLabel, buildEmailSections, defaultEmailDate, filingEvents, formatDay, formatRange, stageLabel } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import type { CalEvent, CalTodo, KlaviyoEmail, PlannedEmail } from "./api";
import { NOTE_TONE, TODO_TONE, emailStage, firstName, typeStyle } from "./constants";

type ListExtra =
  | { date: string; kind: "note"; note: CalEvent }
  | { date: string; kind: "todo"; todo: CalTodo };
import { ApprovalBadge, type ApprovalIndex } from "./approvals";

export function ListView({ today, events, planned, klaviyo, notes = [], todos = [], showPast, filter = "all", approvals, onShowAll, onOpenCampaign, onOpenEmail, onOpenKlaviyo, onOpenNote, onOpenTodo, onAddEmail }: {
  today: string;
  events: CalEvent[];
  /** Notes and to-dos, each on its day (2026-10-01). */
  notes?: CalEvent[];
  todos?: CalTodo[];
  onOpenNote?: (id: number) => void;
  onOpenTodo?: (t: CalTodo) => void;
  planned: PlannedEmail[];
  /** Klaviyo campaigns, drafts included (unlinked drafts show only here). */
  klaviyo: KlaviyoEmail[];
  showPast: boolean;
  /** "needs": only what needs approval (the reminder's Review lands here). */
  filter?: "all" | "needs";
  approvals: ApprovalIndex;
  onShowAll?: () => void;
  onOpenCampaign: (id: number) => void;
  onOpenEmail: (id: number) => void;
  onOpenKlaviyo: (k: KlaviyoEmail) => void;
  onAddEmail: (date: string) => void;
}) {
  const sections = useMemo(() => {
    const extras: ListExtra[] = [
      ...notes.map(n => ({ date: n.startDate, kind: "note" as const, note: n })),
      ...todos.map(t => ({ date: t.date, kind: "todo" as const, todo: t })),
    ];
    const all = buildEmailSections({ campaigns: filingEvents(events), planned, klaviyo, extras, today, showPast });
    if (filter === "all") return all;
    // Needs approval: same sections, only the items that need it, no empty ones.
    return all
      .map(s => ({
        ...s,
        items: s.items.filter(it => it.kind !== "extra" && (it.kind === "planned" ? approvals.forPlan(it.planned.id) : approvals.forKlaviyo(it.klaviyo.id))?.needsApproval === true),
      }))
      .filter(s => s.items.length > 0);
  }, [events, planned, klaviyo, notes, todos, today, showPast, filter, approvals]);

  if (filter === "needs" && sections.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-emerald-500/40 bg-emerald-500/5 p-6 text-center space-y-3">
        <BadgeCheck className="w-8 h-8 text-emerald-600 mx-auto" />
        <p className="text-base font-semibold">Nothing needs approval — all caught up.</p>
        <p className="text-sm text-muted-foreground">Emails join this list once they're a draft or scheduled in Klaviyo and not yet approved.</p>
        {onShowAll && (
          <button type="button" onClick={onShowAll} className="px-4 py-2.5 rounded-xl border-2 border-border font-semibold">Show all emails</button>
        )}
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-border p-6 text-center space-y-3">
        <p className="text-base text-muted-foreground">No phases or emails coming up yet.</p>
        <button type="button" onClick={() => onAddEmail(today)}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add email
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {sections.map(section => {
        const c = section.campaign;
        const style = c ? typeStyle(c.type) : null;
        return (
          <section key={section.key} className={cn("rounded-2xl border-2 overflow-hidden", c ? "border-border" : "border-dashed border-border")}>
            {/* Section header */}
            <div className="flex items-stretch gap-0 bg-secondary/30 border-b border-border">
              {style && <span className={cn("w-2 flex-shrink-0", style.dot)} />}
              {c ? (
                <button type="button" onClick={() => onOpenCampaign(c.id)} className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-secondary/50" title="Open the phase to rename it or change its dates">
                  <span className="flex items-center gap-2 flex-wrap">
                    <Megaphone className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-lg font-bold">{c.title}</span>
                    <span className="text-sm font-semibold text-muted-foreground">{formatRange(c.startDate, c.endDate)}</span>
                    {c.startDate <= today && c.endDate >= today && (
                      <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-primary text-primary-foreground">On now</span>
                    )}
                  </span>
                  {(c.offer || c.summary) && (
                    <span className="block text-sm text-muted-foreground mt-0.5 line-clamp-2">{c.offer || c.summary}</span>
                  )}
                </button>
              ) : (
                <div className="flex-1 px-4 py-3">
                  <span className="text-lg font-bold text-muted-foreground">Not in a phase</span>
                </div>
              )}
              <button type="button" onClick={() => onAddEmail(c ? defaultEmailDate(c, today) : section.items[0]?.date ?? today)}
                className="self-center px-3 sm:px-4 py-2.5 m-2 rounded-xl border-2 border-indigo-500/40 text-indigo-700 dark:text-indigo-300 text-sm font-semibold flex items-center gap-1.5 hover:bg-indigo-500/10 flex-shrink-0">
                <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add email</span><span className="sm:hidden">Email</span>
              </button>
            </div>

            <div className="p-3 space-y-3">
              {section.items.length === 0 && (
                <p className="text-sm text-muted-foreground px-1">No emails planned in this phase yet.</p>
              )}
              {section.items.map(item => item.kind === "planned"
                ? <PlannedCard key={`p-${item.planned.id}`} email={item.planned} klaviyo={item.klaviyo} today={today} approvals={approvals} onOpen={() => onOpenEmail(item.planned.id)} />
                : item.kind === "klaviyo"
                  ? <KlaviyoCard key={`k-${item.klaviyo.id}`} email={item.klaviyo} approvals={approvals} onOpen={() => onOpenKlaviyo(item.klaviyo)} />
                  : item.extra.kind === "note"
                    ? <NoteCard key={`n-${item.extra.note.id}`} note={item.extra.note} today={today} onOpen={() => onOpenNote?.((item.extra as { note: CalEvent }).note.id)} />
                    : <TodoCard key={`t-${item.extra.todo.id}`} todo={item.extra.todo} today={today} onOpen={() => onOpenTodo?.((item.extra as { todo: CalTodo }).todo)} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DateBlock({ date, time, past }: { date: string; time: string | null; past: boolean }) {
  const [dow, d, mon] = formatDay(date).split(" ");
  return (
    <span className={cn("w-16 flex-shrink-0 self-start rounded-xl border-2 text-center py-1.5", past ? "border-border text-muted-foreground" : "border-indigo-500/40")}>
      <span className="block text-xs font-semibold uppercase">{dow}</span>
      <span className="block text-2xl font-bold leading-none">{d}</span>
      <span className="block text-xs font-semibold uppercase">{mon}</span>
      {time && <span className="block text-xs font-semibold text-muted-foreground mt-0.5">{time}</span>}
    </span>
  );
}

function Line({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-start gap-1.5 text-sm min-w-0">
      <span className="text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden>{icon}</span>
      <span className="min-w-0"><span className="text-muted-foreground">{label}: </span>{children}</span>
    </span>
  );
}

function PlannedCard({ email: e, klaviyo, today, approvals, onOpen }: {
  email: PlannedEmail; klaviyo: KlaviyoEmail | null; today: string; approvals: ApprovalIndex; onOpen: () => void;
}) {
  const ap = approvals.forPlan(e.id);
  // Linked: the stage comes from Klaviyo; otherwise the one set by hand.
  const st = emailStage(ap?.stage ?? e.status);
  const audience = [...e.audiences.map(audienceLabel), ...(e.audienceOther ? [e.audienceOther] : [])].join(", ");
  return (
    <button type="button" onClick={onOpen} className="w-full text-left rounded-2xl border-2 border-indigo-500/40 bg-background hover:bg-secondary/30 p-3.5 flex gap-3">
      <DateBlock date={e.sendDate} time={e.sendTime} past={e.sendDate < today} />
      <span className="flex-1 min-w-0 space-y-1.5">
        <span className="flex items-center gap-2 flex-wrap">
          <Mail className="w-4 h-4 text-indigo-600 flex-shrink-0" />
          <span className="text-base font-bold">{e.subject}</span>
        </span>
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", st.chip)}>{st.label}</span>
          {klaviyo && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-500/10 text-teal-700 dark:text-teal-300 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Linked to Klaviyo
            </span>
          )}
          {!klaviyo && e.klaviyoCampaignId && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-secondary text-muted-foreground">Linked to Klaviyo</span>
          )}
          {ap && <ApprovalBadge item={ap} row={approvals.row(ap.key)} />}
        </span>
        <span className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
          {e.offer && <Line icon={<Target className="w-3.5 h-3.5" />} label="Offer">{e.offer}</Line>}
          {e.coreMessage && <Line icon={<MessageSquare className="w-3.5 h-3.5" />} label="Message">{e.coreMessage}</Line>}
          {e.cadence && <Line icon={<Repeat className="w-3.5 h-3.5" />} label="Cadence">{e.cadence}</Line>}
          {audience && <Line icon={<Users className="w-3.5 h-3.5" />} label="Audience">{audience}</Line>}
          {e.websiteChange && <Line icon={<Globe className="w-3.5 h-3.5" />} label="Website">{e.websiteChange}</Line>}
          {e.metaChange && <Line icon={<Megaphone className="w-3.5 h-3.5" />} label="Meta">{e.metaChange}</Line>}
        </span>
      </span>
    </button>
  );
}

function NoteCard({ note: n, today, onOpen }: { note: CalEvent; today: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cn("w-full text-left rounded-2xl border-2 p-3.5 flex gap-3 hover:brightness-[0.98]", NOTE_TONE.card)}>
      <DateBlock date={n.startDate} time={null} past={n.startDate < today} />
      <span className="flex-1 min-w-0 space-y-1">
        <span className="flex items-center gap-2">
          <StickyNote className={cn("w-4 h-4 flex-shrink-0", NOTE_TONE.icon)} />
          <span className="text-base font-bold">{n.title}</span>
        </span>
        {n.notes && <span className="block text-sm text-muted-foreground line-clamp-3 whitespace-pre-line">{n.notes}</span>}
        <span className="block text-xs text-muted-foreground">Note · added by {firstName(n.createdBy?.name)}</span>
      </span>
    </button>
  );
}

function TodoCard({ todo: t, today, onOpen }: { todo: CalTodo; today: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cn("w-full text-left rounded-2xl border-2 p-3.5 flex gap-3 hover:brightness-[0.98]", TODO_TONE.card, t.done && "opacity-60")}>
      <DateBlock date={t.date} time={null} past={t.date < today} />
      <span className="flex-1 min-w-0 space-y-1">
        <span className="flex items-center gap-2">
          {t.done ? <CheckSquare className={cn("w-4 h-4 flex-shrink-0", TODO_TONE.icon)} /> : <Square className={cn("w-4 h-4 flex-shrink-0", TODO_TONE.icon)} />}
          <span className={cn("text-base font-bold", t.done && "line-through")}>{t.title}</span>
        </span>
        <span className="block text-xs text-muted-foreground">
          {t.mine ? "My to-do" : `${firstName(t.assignee.name)}'s to-do`} · {t.dateKind === "due" ? "due" : "scheduled"} this day{t.done ? " · done" : ""}
        </span>
      </span>
    </button>
  );
}

function KlaviyoCard({ email: k, approvals, onOpen }: { email: KlaviyoEmail; approvals: ApprovalIndex; onOpen: () => void }) {
  const ap = approvals.forKlaviyo(k.id);
  const draft = k.status === "Draft";
  return (
    <button type="button" onClick={onOpen} className={cn(
      "w-full text-left rounded-2xl border-2 border-dashed p-3.5 flex gap-3",
      draft ? "border-violet-500/50 bg-violet-500/5 hover:bg-violet-500/10" : "border-teal-500/50 bg-teal-500/5 hover:bg-teal-500/10",
    )}>
      <DateBlock date={k.date} time={format(parseISO(k.sendAt), "HH:mm")} past={k.status === "Sent"} />
      <span className="flex-1 min-w-0 space-y-1">
        <span className={cn("block text-xs font-semibold uppercase tracking-wide", draft ? "text-violet-700 dark:text-violet-300" : "text-teal-700 dark:text-teal-300")}>
          Klaviyo · {draft ? "Draft (not scheduled)" : stageLabel(k.status === "Sent" ? "sent" : "scheduled")} · not planned here
        </span>
        <span className="block text-base font-bold truncate">{k.subject ?? k.name}</span>
        <span className="block text-sm text-muted-foreground truncate">{k.name}{k.audiences.length ? ` · ${k.audiences.join(", ")}` : ""}</span>
        {ap && <ApprovalBadge item={ap} row={approvals.row(ap.key)} />}
      </span>
    </button>
  );
}
