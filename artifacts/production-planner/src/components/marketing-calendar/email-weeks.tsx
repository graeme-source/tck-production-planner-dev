/**
 * The email plan — the marketing calendar's List view (Graeme, 2026-10-14,
 * from his "Free Pack + Black Friday Calendar" design). Objective I.
 *
 * One card per week (Mon→Sun), a row per day: the day (Scheduled? tick,
 * key dates, notes and to-dos), the offer, the email type, and the subject,
 * the campaign name to paste into Klaviyo, Klaviyo's results once sent and
 * a note. Offers take turns week by week; paused weeks (Black Friday) use
 * the planner's own emails. Everything comes from data (Calendar setup).
 *
 * ONE EMAIL = ONE ROW (buildEmailWeeks in @workspace/marketing-calendar): a
 * cycle slot, or the planner email that replaced it, with its Klaviyo send
 * inside it; a Klaviyo send linked to nothing is an "Unplanned Klaviyo
 * email" row on its day. A slot is stored the moment someone acts on it
 * (note, tick, type, link), so it then has stages, approvals and history
 * like every planned email.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import {
  AlertTriangle, CalendarDays, Check, CheckSquare, ChevronDown, Copy, ExternalLink, Link2, Loader2, Mail, Package, Settings2, SkipForward, Square,
  Star, StickyNote, Undo2,
} from "lucide-react";
import {
  EMAIL_TYPE_KEYS, EMAIL_TYPE_LABELS, PLAN_RULE_TEXT, WEEKDAYS_SHORT, addDays, buildEmailWeeks, dayMonth, fillProduct, formatDay,
  offerDayIndexes, startOfWeek, stageLabel, type ListRow, type ListWeek, type ResultForList,
} from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { calApi, createEmail, invalidateEmails, patchEmail, type CalEvent, type CalTodo, type KlaviyoEmail, type PlannedEmail } from "./api";
import { ensureSlot, invalidateCycle, saveSettings, setWeekProduct, useKlaviyoResults, type CycleResponse } from "./cycle-api";
import { ApprovalBadge, type ApprovalIndex } from "./approvals";
import { EMAIL_TYPE_TONE, NOTE_TONE, PAUSE_TONE, TODO_TONE, emailStage, offerTone, typeStyle } from "./constants";

type Row = ListRow<PlannedEmail, KlaviyoEmail>;
type Week = ListWeek<PlannedEmail, KlaviyoEmail>;

export const WEEK_COUNTS = [4, 8, 12, 26] as const;

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 2 : 1)}%`;
const gbp = (x: number) => `£${Math.round(x).toLocaleString("en-GB")}`;

export function EmailWeeks(props: {
  today: string;
  cycle: CycleResponse;
  firstMonday: string;
  weeks: number;
  onWeeksChange: (n: number) => void;
  earlier: number;
  onEarlierChange: (n: number) => void;
  planned: PlannedEmail[];
  klaviyo: KlaviyoEmail[];
  linkedCampaignIds: string[];
  klaviyoError?: string | null;
  approvals: ApprovalIndex;
  /** Other calendar entries shown on their days / weeks. */
  notes: CalEvent[];
  todos: CalTodo[];
  events: CalEvent[];
  onOpenEmail: (id: number) => void;
  onOpenKlaviyo: (k: KlaviyoEmail) => void;
  onOpenNote: (id: number) => void;
  onOpenTodo: (t: CalTodo) => void;
  onOpenEvent: (id: number) => void;
  onOpenSetup: () => void;
}) {
  const { today, cycle, planned, klaviyo } = props;
  const resultsQ = useKlaviyoResults();
  const results = useMemo(() => new Map((resultsQ.data?.results ?? []).map(r => [r.campaignId, r])), [resultsQ.data]);
  const weeks = useMemo(() => buildEmailWeeks({
    config: cycle.config, firstMonday: props.firstMonday, weeks: props.weeks, planned, klaviyo,
    linkedCampaignIds: props.linkedCampaignIds, results, keyDates: cycle.keyDates, products: cycle.products, today,
  }), [cycle, props.firstMonday, props.weeks, planned, klaviyo, props.linkedCampaignIds, results, today]);

  const offers = cycle.config.offers;
  const offerDays = offerDayIndexes(cycle.config.weeklyPlan);
  const offerSpan = `${WEEKDAYS_SHORT[offerDays[0]]}–${WEEKDAYS_SHORT[offerDays[offerDays.length - 1]]}`;
  const pausesAhead = cycle.config.pauses.filter(p => p.endDate >= today);

  return (
    <div className="space-y-5">
      {/* What this is */}
      <header className="space-y-2">
        <p className="text-base text-muted-foreground max-w-prose">
          Which Klaviyo email goes out each day, and for which offer. Each offer runs for one week, {offerSpan}; after
          the last offer it goes back to the first.
        </p>
        {pausesAhead.map(p => (
          <p key={p.id} className="text-base text-muted-foreground max-w-prose">
            From {dayMonth(p.startDate)} to {dayMonth(p.endDate)}, the cycle pauses for the {p.name} plan in this calendar, then carries on where it left off.
          </p>
        ))}
        <p className="text-base font-semibold max-w-prose">This is our basic structure - alter emails to match seasonal changes or whatever is relevant for those weeks.</p>
      </header>

      {/* The offers */}
      {offers.length > 0 ? (
        <section aria-label="Offer cycle" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {offers.map((o, i) => {
            const t = offerTone(o.colour);
            return (
              <div key={o.id} className={cn("rounded-2xl p-4 border-l-[6px] space-y-1", t.head, t.edge)}>
                <p className={cn("text-xs font-mono font-semibold uppercase tracking-wide", t.big)}>Offer {i + 1}{o.tag ? ` · ${o.tag}` : ""}</p>
                <p className="font-semibold leading-snug">{o.name}</p>
                <p className="text-sm text-muted-foreground">Week {i + 1} · {offerSpan}{o.featuresProduct ? " · features a product" : ""}</p>
              </div>
            );
          })}
        </section>
      ) : (
        <p className="rounded-2xl border-2 border-dashed border-border p-4 text-base text-muted-foreground">
          No offers in the cycle yet{cycle.canEditSetup ? " — add them in Calendar setup." : "."}
        </p>
      )}

      {/* The weekly rules */}
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
        {cycle.config.weeklyPlan.map((t, i) => (
          <li key={i}><span className="text-primary mr-1.5">•</span><b className="text-foreground">{WEEKDAYS_SHORT[i]}:</b> {t ? PLAN_RULE_TEXT[t] : "no email"}</li>
        ))}
      </ul>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <StartControl cycle={cycle} />
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Weeks to show
          <select value={props.weeks} onChange={e => props.onWeeksChange(Number(e.target.value))}
            className="px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base font-normal normal-case tracking-normal text-foreground">
            {WEEK_COUNTS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {props.earlier === 0 ? (
          <button type="button" onClick={() => props.onEarlierChange(4)} className="px-4 py-2.5 rounded-xl border-2 border-border font-semibold hover:bg-secondary/50">
            Show earlier weeks
          </button>
        ) : (
          <button type="button" onClick={() => props.onEarlierChange(0)} className="px-4 py-2.5 rounded-xl border-2 border-border font-semibold hover:bg-secondary/50 flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4" /> Back to this week
          </button>
        )}
        <div className="flex-1" />
        {cycle.canEditSetup && (
          <button type="button" onClick={props.onOpenSetup} className="px-4 py-2.5 rounded-xl border-2 border-primary/50 text-primary font-semibold flex items-center gap-1.5 hover:bg-primary/10">
            <Settings2 className="w-4 h-4" /> Calendar setup
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <span>Tick each email once it's scheduled in Klaviyo — it ticks itself once Klaviyo has it scheduled or sent. Name the Klaviyo campaign with the campaign name shown and the two link up as one email.</span>
        <span>
          {resultsQ.isLoading ? "Klaviyo results: loading…"
            : !resultsQ.data?.connected ? "Klaviyo results appear once Klaviyo is connected."
              : resultsQ.data.error ? <span className="text-amber-700 dark:text-amber-400">Klaviyo results: {resultsQ.data.error}</span>
                : resultsQ.data.updatedAt ? `Klaviyo results: last 12 months, updated ${formatDistanceToNowStrict(parseISO(resultsQ.data.updatedAt))} ago`
                  : "Klaviyo results: none yet"}
        </span>
        {props.klaviyoError && <span className="text-amber-700 dark:text-amber-400">Klaviyo emails: {props.klaviyoError}</span>}
      </div>

      <div className="space-y-5">
        {weeks.map(w => (
          <WeekCard key={w.monday} week={w} {...props} offers={offers} />
        ))}
      </div>
    </div>
  );
}

/** The cycle's start Monday — the founder edits it (autosaved), others read it. */
function StartControl({ cycle }: { cycle: CycleResponse }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(cycle.config.startDate);
  const save = useAutosave<string>(async d => { await saveSettings({ startDate: d }); await invalidateCycle(qc); }, 300);
  useEffect(() => { if (save.state !== "dirty" && save.state !== "saving") setValue(cycle.config.startDate); }, [cycle.config.startDate, save.state]);
  if (!cycle.canEditSetup) {
    return (
      <div className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Cycle starts
        <span className="px-3 py-2.5 rounded-xl border-2 border-border text-base font-normal normal-case tracking-normal text-foreground">{formatDay(cycle.config.startDate)}</span>
      </div>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      Cycle starts (a Monday)
      <span className="flex items-center gap-2">
        <input type="date" value={value}
          onChange={e => {
            const v = e.target.value;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { setValue(v); return; }
            const monday = startOfWeek(v);
            setValue(monday);
            save.schedule(monday);
          }}
          className="px-3 py-2 rounded-xl border-2 border-border bg-background text-base font-normal normal-case tracking-normal text-foreground" />
        <span className="normal-case tracking-normal font-normal"><SaveChip state={save.state} error={save.error} onRetry={save.flush} /></span>
      </span>
    </label>
  );
}

type WeekCardProps = Parameters<typeof EmailWeeks>[0] & { week: Week; offers: CycleResponse["config"]["offers"] };

function WeekCard(props: WeekCardProps) {
  const { week: w, cycle, today } = props;
  const tone = w.pause ? PAUSE_TONE : offerTone(w.offer?.colour);
  const productLive = !w.pause && w.offer?.featuresProduct;
  const others = props.events.filter(e => e.type !== "campaign" && e.type !== "note" && e.startDate <= w.sunday && e.endDate >= w.monday);
  const offerName = w.offer ? fillProduct(w.offer.name, w.product) : null;
  const days = offerDayIndexes(cycle.config.weeklyPlan);
  const first = days[0], last = days[days.length - 1];
  return (
    <article className={cn("@container rounded-2xl border-2 bg-card overflow-hidden border-l-[6px]", tone.edge, w.isThisWeek ? "border-primary ring-1 ring-primary" : "border-border")}>
      <div className={cn("px-4 py-3.5 border-b border-border space-y-2", tone.head)}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {w.pause ? (
            <>
              <span className={cn("text-2xl font-extrabold tracking-tight", tone.big)}>{w.pause.name}</span>
              <span className="font-semibold">{w.phases.length ? `${w.phases.join(" + ")} · ` : ""}no cycle offer this week</span>
            </>
          ) : w.offer ? (
            <>
              <span className={cn("text-2xl font-extrabold tracking-tight", tone.big)}>Offer {w.offerNumber} live</span>
              <span className="font-semibold">{offerName}</span>
            </>
          ) : (
            <span className="text-2xl font-extrabold tracking-tight text-muted-foreground">No offer set</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <h3 className="text-lg font-bold">
            {dayMonth(w.monday)} – {dayMonth(w.sunday)}
            {w.isThisWeek && <span className="ml-2 align-middle text-xs font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground">This week</span>}
          </h3>
          <span className="text-sm text-muted-foreground">
            {w.pause ? `Cycle paused · ${dayMonth(w.pause.startDate)} – ${dayMonth(w.pause.endDate)}` : `Runs ${WEEKDAYS_SHORT[first]} ${dayMonth(addDays(w.monday, first))} – ${WEEKDAYS_SHORT[last]} ${dayMonth(addDays(w.monday, last))}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={cn("text-sm tabular-nums", w.total > 0 && w.done === w.total ? "text-primary font-bold" : "text-muted-foreground")}>
            {w.done} of {w.total} scheduled
          </span>
          {w.hasResults && <span className="text-sm font-bold text-primary tabular-nums">{w.orders} orders · {gbp(w.revenue)} from emails</span>}
          {productLive && <ProductBox monday={w.monday} product={w.product} />}
          {w.bigKeyDates.length > 0 && (
            <span className="text-sm font-bold text-red-700 dark:text-red-300 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" /> {w.bigKeyDates.join(" & ")} this week. Check whether this offer still runs.
            </span>
          )}
          {others.map(e => (
            <button key={e.id} type="button" onClick={() => props.onOpenEvent(e.id)} className={cn("text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1", typeStyle(e.type).chip)}>
              {e.type === "test_box" && <Package className="w-3.5 h-3.5" />}{e.title}
            </button>
          ))}
        </div>
      </div>

      {/* Column labels. The columns follow the card's own width (the panel
          beside the sidebar), not the screen: four columns on a wide panel,
          offer + email | subject on iPad, stacked only on a phone. */}
      <div className="hidden @3xl:grid grid-cols-[6.5rem_10rem_8rem_minmax(0,1fr)] @6xl:grid-cols-[8.5rem_12rem_8rem_minmax(0,1fr)] gap-4 px-4 py-2 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Day</span><span>Offer</span><span>Email</span><span>Subject idea, campaign name &amp; notes</span>
      </div>
      <div className="hidden @md:grid @3xl:hidden grid-cols-[9rem_minmax(0,1fr)] gap-4 px-4 py-2 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Offer &amp; email</span><span>Subject idea, campaign name &amp; notes</span>
      </div>
      <div className="divide-y divide-border">
        {w.days.map(d => (
          <DayBlock key={d.date} {...props} day={d} week={w} />
        ))}
      </div>
    </article>
  );
}

function ProductBox({ monday, product }: { monday: string; product: string | null }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(product ?? "");
  const save = useAutosave<string>(async v => { await setWeekProduct(monday, v.trim() || null); await invalidateCycle(qc); });
  useEffect(() => { if (save.state !== "dirty" && save.state !== "saving") setValue(product ?? ""); }, [product, save.state]);
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      Product added this week:
      <input value={value} onChange={e => { setValue(e.target.value); save.schedule(e.target.value); }} onBlur={() => void save.flush()}
        placeholder="e.g. Carnizone" maxLength={120}
        className="w-48 max-w-full px-3 py-2 rounded-xl border-2 border-border bg-background text-base text-foreground" />
      <SaveChip state={save.state} error={save.error} onRetry={save.flush} />
    </label>
  );
}

function DayBlock(props: WeekCardProps & { day: Week["days"][number] }) {
  const { day: d } = props;
  const notes = props.notes.filter(n => n.startDate === d.date);
  const todos = props.todos.filter(t => t.date === d.date);
  const rest = d.rows.length === 0;
  const virtualSlot = d.rows.some(r => r.kind === "email" && r.planned == null);
  return (
    <div className={cn("grid grid-cols-1 @3xl:grid-cols-[6.5rem_minmax(0,1fr)] @6xl:grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3", d.weekday === 5 && "bg-secondary/30", d.isToday && "bg-primary/5")}>
      <div className="flex @3xl:flex-col flex-wrap items-baseline @3xl:items-start gap-x-2 gap-y-1">
        <span className="font-bold text-base">{WEEKDAYS_SHORT[d.weekday]}{d.isToday && <span className="ml-1.5 text-xs font-bold text-primary">Today</span>}</span>
        <span className="text-sm text-muted-foreground tabular-nums">{dayMonth(d.date)}</span>
        {d.keyDates.map(k => (
          <span key={k.id} className={cn("text-xs font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1",
            k.big ? "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200" : "bg-yellow-100 text-yellow-900 dark:bg-yellow-400/15 dark:text-yellow-100")}>
            <Star className="w-3 h-3" /> {k.name}
          </span>
        ))}
        {notes.map(n => (
          <button key={n.id} type="button" onClick={() => props.onOpenNote(n.id)} className={cn("text-xs font-semibold px-2 py-0.5 rounded-lg inline-flex items-center gap-1 max-w-full", NOTE_TONE.chip)}>
            <StickyNote className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{n.title}</span>
          </button>
        ))}
        {todos.map(t => (
          <button key={t.id} type="button" onClick={() => props.onOpenTodo(t)} className={cn("text-xs font-semibold px-2 py-0.5 rounded-lg inline-flex items-center gap-1 max-w-full", t.done ? TODO_TONE.done : TODO_TONE.chip)}>
            {t.done ? <CheckSquare className="w-3 h-3 flex-shrink-0" /> : <Square className="w-3 h-3 flex-shrink-0" />} <span className="truncate">{t.title}</span>
          </button>
        ))}
      </div>
      <div className="space-y-3 min-w-0">
        {rest && <p className="text-sm italic text-muted-foreground py-1">No email</p>}
        {d.rows.map(r => (
          <RowView key={r.kind === "email" && r.slot ? `slot-${r.date}` : r.key} row={r} virtualSlot={virtualSlot} {...props} />
        ))}
      </div>
    </div>
  );
}

function RowView(props: WeekCardProps & { row: Row; virtualSlot: boolean }) {
  const { row } = props;
  if (row.kind === "moved") {
    return (
      <div className="text-sm text-muted-foreground italic flex flex-wrap items-center gap-2 py-1">
        This day's {row.slot.type === "free_slot" ? "free slot" : EMAIL_TYPE_LABELS[row.slot.type].toLowerCase()} email moved to {formatDay(row.planned.sendDate)}.
        <button type="button" onClick={() => props.onOpenEmail(row.planned.id)} className="not-italic font-semibold text-primary underline">Open it</button>
      </div>
    );
  }
  if (row.kind === "unplanned") return <UnplannedRow {...props} row={row} />;
  return <EmailRow {...props} row={row} />;
}

function useActOnRow(row: Extract<Row, { kind: "email" }>) {
  const qc = useQueryClient();
  /** The stored email's id — the slot is stored first if it isn't yet. */
  const idRef = useRef<number | null>(row.planned?.id ?? null);
  useEffect(() => { if (row.planned) idRef.current = row.planned.id; }, [row.planned]);
  const ensure = async () => {
    if (idRef.current != null) return idRef.current;
    idRef.current = await ensureSlot(row.date);
    return idRef.current;
  };
  const refresh = () => Promise.all([invalidateEmails(qc), qc.invalidateQueries({ queryKey: ["marketing-calendar", "approvals"] })]);
  return { ensure, refresh };
}

function EmailRow(props: WeekCardProps & { row: Extract<Row, { kind: "email" }> }) {
  const { row, week: w, approvals } = props;
  const p = row.planned;
  const { ensure, refresh } = useActOnRow(row);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what); setErr(null);
    try { await fn(); await refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save that"); } finally { setBusy(null); }
  };

  // The offer column: the planner email's phase, else the week's offer, else a free slot.
  const phase = p?.campaignTitle ?? null;
  const offer = row.slot?.offer ?? (w.pause ? null : w.offer);
  const offerNo = row.slot?.offerNumber ?? (w.pause ? null : w.offerNumber);
  const isFree = row.type === "free_slot";
  const ap = p ? approvals.forPlan(p.id) : null;
  const stage = emailStage(ap?.stage ?? p?.status ?? "planned");
  const k = row.klaviyo;
  const r = row.result;

  return (
    <div className={cn("flex flex-wrap items-start gap-x-4 gap-y-2 @md:grid @md:grid-cols-[9rem_minmax(0,1fr)] @md:grid-rows-[auto_1fr] @3xl:grid-cols-[10rem_8rem_minmax(0,1fr)] @3xl:grid-rows-none @6xl:grid-cols-[12rem_8rem_minmax(0,1fr)]", row.skipped && "opacity-60")}>
      {/* Offer */}
      <div className="flex flex-wrap items-center gap-2 min-w-0 @md:col-start-1 @md:row-start-1">
        {phase ? (
          <span className={cn("text-xs font-bold px-2 py-1 rounded-md", w.pause ? PAUSE_TONE.chip : typeStyle("campaign").chip)}>{phase}</span>
        ) : isFree ? (
          <span className="text-xs font-bold px-2 py-1 rounded-md border border-dashed border-muted-foreground text-muted-foreground">Free slot</span>
        ) : offer ? (
          <span className={cn("text-xs font-bold px-2 py-1 rounded-md", offerTone(offer.colour).chip)}>Offer {offerNo}</span>
        ) : null}
        <span className="text-sm min-w-0">
          {isFree && !p ? <>Random or creative email. Idea: {row.slot?.idea}</> : p?.offer ? fillProduct(p.offer, w.product) : !phase && offer ? fillProduct(offer.name, w.product) : null}
        </span>
      </div>

      {/* Email type + Scheduled tick */}
      <div className="flex @md:flex-col flex-wrap items-center @md:items-start gap-2 @md:col-start-1 @md:row-start-2 @3xl:col-start-2 @3xl:row-start-1">
        <TypeSelect value={row.type} disabled={busy != null} onChange={t => run("type", async () => patchEmail(await ensure(), { emailType: t }))} />
        <button type="button" disabled={row.scheduledByKlaviyo || busy != null}
          onClick={() => run("tick", async () => patchEmail(await ensure(), { status: row.scheduled ? "planned" : "scheduled" }))}
          aria-pressed={row.scheduled}
          title={row.scheduledByKlaviyo ? "Klaviyo has it scheduled or sent" : undefined}
          className={cn("flex items-center gap-1.5 text-sm font-semibold rounded-lg px-2 py-1 -ml-2 min-h-[40px]",
            row.scheduled ? "text-primary" : "text-muted-foreground hover:text-foreground", row.scheduledByKlaviyo && "cursor-default")}>
          {busy === "tick" ? <Loader2 className="w-5 h-5 animate-spin" /> : row.scheduled
            ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
          {row.scheduled ? (row.scheduledByKlaviyo ? (k?.status === "Sent" ? "Sent" : "Scheduled in Klaviyo") : "Scheduled") : "Scheduled?"}
        </button>
      </div>

      {/* Subject, campaign name, Klaviyo, results, note */}
      <div className="min-w-0 space-y-2 basis-full @md:basis-auto @md:col-start-2 @md:row-start-1 @md:row-span-2 @3xl:col-start-3 @3xl:row-span-1">
        <p className={cn("text-base font-semibold", row.skipped && "line-through")}>{row.subject}</p>
        <CampaignName name={row.campaignName} />
        <div className="flex flex-wrap items-center gap-2">
          {p && <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", stage.chip)}>{stage.label}</span>}
          {ap && <ApprovalBadge item={ap} row={approvals.row(ap.key)} />}
          {row.skipped && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-secondary text-muted-foreground">Skipped this week</span>}
          {k ? (
            <a href={k.klaviyoUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-800 dark:text-teal-200 inline-flex items-center gap-1 max-w-full">
              <Mail className="w-3.5 h-3.5 flex-shrink-0" /> <span className="truncate">In Klaviyo: {k.name} · {k.status === "Draft" ? "draft" : k.status.toLowerCase()}</span> <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </a>
          ) : p?.klaviyoCampaignId ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Linked to Klaviyo: {p.klaviyoCampaignName ?? "campaign"}</span>
          ) : null}
        </div>
        {r && <ResultBox name={k?.name ?? null} r={r} />}
        <NoteBox row={row} ensure={ensure} />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy != null} onClick={() => run("open", async () => props.onOpenEmail(await ensure()))}
            className="px-3 py-2 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary/50 inline-flex items-center gap-1.5">
            {busy === "open" && <Loader2 className="w-4 h-4 animate-spin" />} Open
          </button>
          {!p?.klaviyoCampaignId && (
            <button type="button" disabled={busy != null} onClick={() => run("open", async () => props.onOpenEmail(await ensure()))}
              className="px-3 py-2 rounded-xl border-2 border-teal-500/40 text-teal-800 dark:text-teal-200 text-sm font-semibold hover:bg-teal-500/10 inline-flex items-center gap-1.5">
              <Link2 className="w-4 h-4" /> Link to Klaviyo campaign…
            </button>
          )}
          {row.slot && (!p || p.cycleDate) && !k && (
            <button type="button" disabled={busy != null} onClick={() => run("skip", async () => patchEmail(await ensure(), { skipped: !row.skipped }))}
              className="px-3 py-2 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary/50 inline-flex items-center gap-1.5">
              {row.skipped ? <><Undo2 className="w-4 h-4" /> Put back</> : <><SkipForward className="w-4 h-4" /> Skip this week</>}
            </button>
          )}
        </div>
        {err && <p className="text-sm text-destructive flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {err}</p>}
      </div>
    </div>
  );
}

function TypeSelect({ value, disabled, onChange }: { value: string | null; disabled?: boolean; onChange: (t: string | null) => void }) {
  return (
    <span className="relative inline-flex">
      <select value={value ?? ""} disabled={disabled} onChange={e => onChange(e.target.value || null)} aria-label="Email type"
        className={cn("appearance-none text-xs font-bold pl-2.5 pr-6 py-1.5 rounded-md border cursor-pointer", value ? EMAIL_TYPE_TONE[value] : "bg-secondary text-muted-foreground border-border")}>
        <option value="">Email</option>
        {EMAIL_TYPE_KEYS.map(t => <option key={t} value={t}>{EMAIL_TYPE_LABELS[t]}</option>)}
      </select>
      <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
    </span>
  );
}

function CampaignName({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(name); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { /* the text stays selectable */ }
  };
  return (
    <div className="flex items-center gap-2 min-w-0">
      <code className="text-xs font-mono text-muted-foreground break-all select-all">{name}</code>
      <button type="button" onClick={() => void copy()} className="flex-shrink-0 text-xs font-semibold px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
        {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
      </button>
    </div>
  );
}

function ResultBox({ name, r }: { name: string | null; r: ResultForList }) {
  return (
    <div className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm tabular-nums flex flex-wrap gap-x-4 gap-y-1">
      {name && <span className="basis-full text-xs text-muted-foreground">Sent: {name}</span>}
      <span><b>{r.recipients.toLocaleString("en-GB")}</b> sent</span>
      <span><b>{pct(r.openRate)}</b> opened</span>
      <span><b>{pct(r.clickRate)}</b> clicked</span>
      <span><b>{r.orders}</b> orders</span>
      <span className="font-bold text-primary">{gbp(r.revenue)}</span>
    </div>
  );
}

/** The day's note — autosaves to the planned email's notes (storing the slot first). */
function NoteBox({ row, ensure }: { row: Extract<Row, { kind: "email" }>; ensure: () => Promise<number> }) {
  const qc = useQueryClient();
  const server = row.planned?.notes ?? "";
  const [value, setValue] = useState(server);
  const save = useAutosave<string>(async v => {
    const id = await ensure();
    await patchEmail(id, { notes: v.trim() || null });
    await invalidateEmails(qc);
  });
  useEffect(() => { if (save.state !== "dirty" && save.state !== "saving") setValue(server); }, [server, save.state]);
  return (
    <div className="space-y-1">
      <textarea value={value} rows={1} maxLength={10000}
        onChange={e => { setValue(e.target.value); save.schedule(e.target.value); }} onBlur={() => void save.flush()}
        placeholder="Add a note (seasonal angle, image to use…)"
        className="w-full min-h-[44px] rounded-xl border-2 border-dashed border-border focus:border-solid focus:border-primary bg-transparent px-3 py-2 text-sm resize-y" />
      {save.state !== "idle" && <SaveChip state={save.state} error={save.error} onRetry={save.flush} />}
    </div>
  );
}

function UnplannedRow(props: WeekCardProps & { row: Extract<Row, { kind: "unplanned" }>; virtualSlot: boolean }) {
  const { row, approvals } = props;
  const k = row.klaviyo;
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ap = approvals.forKlaviyo(k.id);
  const draft = k.status === "Draft";
  const link = async (emailId: number) => {
    await calApi(`/marketing-calendar/emails/${emailId}/klaviyo`, { method: "PUT", body: JSON.stringify({ klaviyoCampaignId: k.id, klaviyoCampaignName: k.name }) });
  };
  const addToPlan = async () => {
    setBusy(true); setErr(null);
    try {
      if (props.virtualSlot) await link(await ensureSlot(row.date));
      else {
        const r = await createEmail({ sendDate: row.date, subject: (k.subject ?? k.name).slice(0, 300) });
        await link(r.email.id);
      }
      await Promise.all([invalidateEmails(qc), qc.invalidateQueries({ queryKey: ["marketing-calendar"] })]);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't add it"); } finally { setBusy(false); }
  };
  return (
    <div className={cn("rounded-xl border-2 border-dashed p-3 space-y-2", draft ? "border-violet-500/50 bg-violet-500/5" : "border-teal-500/50 bg-teal-500/5")}>
      <p className={cn("text-xs font-bold uppercase tracking-wide", draft ? "text-violet-700 dark:text-violet-300" : "text-teal-700 dark:text-teal-300")}>
        Unplanned Klaviyo email · {draft ? "draft" : stageLabel(k.status === "Sent" ? "sent" : "scheduled")}
      </p>
      <p className="text-base font-semibold">{k.subject ?? k.name}</p>
      <p className="text-sm text-muted-foreground break-words">{k.name}</p>
      {ap && <ApprovalBadge item={ap} row={approvals.row(ap.key)} />}
      {row.result && <ResultBox name={null} r={row.result} />}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => props.onOpenKlaviyo(k)} className="px-3 py-2 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary/50">Open</button>
        <button type="button" disabled={busy} onClick={() => void addToPlan()}
          className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          {props.virtualSlot ? "This is this day's planned email" : "Add to the plan"}
        </button>
      </div>
      {err && <p className="text-sm text-destructive flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {err}</p>}
    </div>
  );
}
