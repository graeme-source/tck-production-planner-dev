/**
 * The email plan (Graeme, 2026-10-14) — the List view of the marketing
 * calendar: one card per week (Mon→Sun), a row per day, which email goes out
 * and for which offer. Objective I. PURE and tested (email-cycle.test.ts);
 * the server and the page both use it.
 *
 * THE CYCLE. Offers take turns, one per week, in order; after the last it
 * goes back to the first. A weekly plan says which email type goes on which
 * weekday (launch on Monday, follow-up Wednesday…; null = no email). Every
 * offer, subject idea, Saturday idea, key date and pause is DATA (Calendar
 * setup) — nothing here names a product or an offer.
 *
 * PAUSES (e.g. Black Friday). A week is paused when any of its offer days
 * (the weekdays the plan gives an offer email) falls inside a pause. A
 * paused week has no cycle emails — its emails are the planner's own — and
 * does NOT use up an offer: the cycle carries on with the next offer after.
 * A cycle email on a single day inside a pause (a Sunday the pause starts
 * on, say) is dropped too.
 *
 * ONE EMAIL = ONE ROW. On a cycle day the row is, in order of preference:
 *   1. the planned email made from that slot (marketing_emails.cycle_date),
 *   2. else the first other planned email on that day — the planner's email
 *      replaces the cycle idea (that's how a seasonal week is altered),
 *   3. else the cycle idea itself (not stored until someone acts on it).
 * Any other planned emails that day are rows of their own. A Klaviyo
 * campaign linked to a planned email shows INSIDE that row; one linked to
 * nothing is an "Unplanned Klaviyo email" row on its send day.
 */
import { addDays, daysBetween, mondayIndex, startOfWeek } from "./calendar";

// ── Email types ─────────────────────────────────────────────────────────────
export const EMAIL_TYPE_KEYS = ["launch", "follow_up", "new_angle", "last_call", "free_slot", "teaser", "extension"] as const;
export type EmailTypeKey = (typeof EMAIL_TYPE_KEYS)[number];

/** The four emails each offer week sends, in order, with a subject idea each. */
export const OFFER_EMAIL_TYPES = ["launch", "follow_up", "new_angle", "last_call"] as const;
export type OfferEmailType = (typeof OFFER_EMAIL_TYPES)[number];

/** What the weekly plan may put on a day (null = no email). */
export type PlanDayType = OfferEmailType | "free_slot";
export const PLAN_DAY_TYPES: readonly PlanDayType[] = [...OFFER_EMAIL_TYPES, "free_slot"];

export const EMAIL_TYPE_LABELS: Record<EmailTypeKey, string> = {
  launch: "Launch",
  follow_up: "Follow-up",
  new_angle: "New angle",
  last_call: "Last call",
  free_slot: "Free slot",
  teaser: "Teaser",
  extension: "Extension",
};

/** How each day's rule reads in the rules list. */
export const PLAN_RULE_TEXT: Record<PlanDayType, string> = {
  launch: "launch",
  follow_up: "follow-up",
  new_angle: "same offer, new angle",
  last_call: "last call, offer ends today",
  free_slot: "free slot (random or creative)",
};

/** The type's piece of a campaign name: "1 Launch" … "4 Last Call". */
const CAMPAIGN_TYPE_PART: Record<OfferEmailType, string> = {
  launch: "1 Launch",
  follow_up: "2 Follow-up",
  new_angle: "3 New Angle",
  last_call: "4 Last Call",
};

export function isEmailType(v: unknown): v is EmailTypeKey {
  return typeof v === "string" && (EMAIL_TYPE_KEYS as readonly string[]).includes(v);
}
export function isOfferEmailType(v: unknown): v is OfferEmailType {
  return typeof v === "string" && (OFFER_EMAIL_TYPES as readonly string[]).includes(v);
}

export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Oct". */
export function dayMonth(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

// ── Config (all data) ───────────────────────────────────────────────────────
export type WeeklyPlan = ReadonlyArray<PlanDayType | null>;

export interface CycleOffer {
  id: number;
  /** Campaign-name code, e.g. "O1 Free Pack £39.95". */
  code: string;
  /** The offer as customers read it. */
  name: string;
  tag: string | null;
  /** Colour key (the page maps it to light/dark tokens). */
  colour: string;
  /** "(Product)" in its texts is filled from the week's product. */
  featuresProduct: boolean;
  subjects: Partial<Record<OfferEmailType, string | null>>;
}

export interface CyclePause { id: number; name: string; startDate: string; endDate: string }
export interface KeyDate { id: number; date: string; name: string; big: boolean }
export interface FreeSlotIdea { idea: string; subject: string }

export interface CycleConfig {
  /** A Monday. */
  startDate: string;
  weeklyPlan: WeeklyPlan;
  /** In cycle order (deleted ones already left out). */
  offers: readonly CycleOffer[];
  pauses: readonly CyclePause[];
  freeIdeas: readonly FreeSlotIdea[];
  /** Days whose cycle email someone deleted from the plan (Graeme,
   *  2026-10-15: "clear it out and delete that email from the day") — no
   *  slot is offered there any more, by the list, the slot maker or the
   *  Klaviyo name-linker. */
  removedDays?: readonly string[];
}

/** Any stored value → a 7-day plan (bad entries become "no email"). */
export function normaliseWeeklyPlan(raw: unknown): WeeklyPlan {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: 7 }, (_, i) => {
    const v = arr[i];
    return typeof v === "string" && (PLAN_DAY_TYPES as readonly string[]).includes(v) ? (v as PlanDayType) : null;
  });
}

export function normaliseFreeIdeas(raw: unknown): FreeSlotIdea[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(x => {
    const o = x as { idea?: unknown; subject?: unknown } | null;
    const idea = typeof o?.idea === "string" ? o.idea.trim() : "";
    const subject = typeof o?.subject === "string" ? o.subject.trim() : "";
    return idea || subject ? [{ idea: idea || subject, subject: subject || idea }] : [];
  });
}

export function normaliseSubjects(raw: unknown): Partial<Record<OfferEmailType, string | null>> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Partial<Record<OfferEmailType, string | null>> = {};
  for (const t of OFFER_EMAIL_TYPES) {
    const v = o[t];
    out[t] = typeof v === "string" && v.trim() ? v.trim() : null;
  }
  return out;
}

// ── The product of the week ─────────────────────────────────────────────────
export const PRODUCT_TOKEN = "(Product)";

/** Fill "(Product)" with the week's product (left as it is when none). */
export function fillProduct(text: string, product: string | null | undefined): string {
  const p = (product ?? "").trim();
  return p ? text.replace(/\(product\)/gi, p) : text;
}

// ── Cycle maths ─────────────────────────────────────────────────────────────
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Days of the week the plan gives an OFFER email (Mon–Fri if none). */
export function offerDayIndexes(plan: WeeklyPlan): number[] {
  const idx = plan.flatMap((t, i) => (t && t !== "free_slot" ? [i] : []));
  return idx.length ? idx : [0, 1, 2, 3, 4];
}

export function pauseOn(date: string, pauses: readonly CyclePause[]): CyclePause | null {
  return pauses.find(p => p.startDate <= date && p.endDate >= date) ?? null;
}

/** The pause that takes the week starting `monday`, or null. */
export function weekPause(monday: string, config: Pick<CycleConfig, "weeklyPlan" | "pauses">): CyclePause | null {
  for (const i of offerDayIndexes(config.weeklyPlan)) {
    const p = pauseOn(addDays(monday, i), config.pauses);
    if (p) return p;
  }
  return null;
}

/** Whole weeks from the cycle's first week to this one (negative before it). */
export function cycleWeekNumber(monday: string, startDate: string): number {
  return Math.floor(daysBetween(startOfWeek(startDate), startOfWeek(monday)) / 7);
}

const MAX_WEEKS = 5200; // a century — guards the loops below

/**
 * Which offer runs in the week starting `monday`: its index in
 * config.offers, or null when the week is paused, before the cycle's first
 * week, or there are no offers.
 * Paused weeks between the cycle start and this week don't use up an offer.
 */
export function offerIndexForWeek(monday: string, config: Pick<CycleConfig, "startDate" | "weeklyPlan" | "pauses" | "offers">): number | null {
  const n = config.offers.length;
  if (n === 0) return null;
  const week = startOfWeek(monday);
  if (weekPause(week, config)) return null;
  const start = startOfWeek(config.startDate);
  const w = cycleWeekNumber(week, start);
  // Before the cycle starts there is no cycle (those weeks are the planner's).
  if (w < 0) return null;
  if (w > MAX_WEEKS) return mod(w, n);
  let active = 0;
  for (let j = 0; j < w; j++) if (!weekPause(addDays(start, j * 7), config)) active++;
  return mod(active, n);
}

/** The Saturday (free slot) idea for the week — rotates every week. */
export function freeIdeaForWeek(monday: string, config: Pick<CycleConfig, "startDate" | "freeIdeas">): FreeSlotIdea | null {
  const n = config.freeIdeas.length;
  if (n === 0) return null;
  return config.freeIdeas[mod(cycleWeekNumber(monday, config.startDate), n)];
}

// ── Campaign names (what the team pastes into Klaviyo) ──────────────────────
/** "12 Oct – O1 Free Pack £39.95 – 1 Launch". */
export function cycleCampaignName(date: string, offerCode: string, type: OfferEmailType, product?: string | null): string {
  return `${dayMonth(date)} – ${fillProduct(offerCode, product)} – ${CAMPAIGN_TYPE_PART[type]}`;
}

/** "17 Oct – Saturday – Vote on our next flavour". */
export function freeSlotCampaignName(date: string, idea: string): string {
  return `${dayMonth(date)} – ${WEEKDAYS_LONG[mondayIndex(date)]} – ${idea}`;
}

/** A planned email's: "2 Nov – Better Than Black Friday Launch Week 1 – Offer Live…". */
export function plannedCampaignName(date: string, label: string | null | undefined, subject: string): string {
  return `${dayMonth(date)} – ${(label ?? "").trim() || "Email"} – ${subject.trim()}`;
}

/** Campaign names compared the way people type them: case, dash style,
 *  spacing and Klaviyo's "(clone)" / "(copy)" don't matter. */
export function normaliseCampaignName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s*\((?:clone|cloned|copy)\)\s*/g, " ")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Slots ───────────────────────────────────────────────────────────────────
export interface CycleSlot {
  date: string;
  /** 0 = Monday. */
  weekday: number;
  type: PlanDayType;
  /** The week's offer (null on a free slot when no offer runs). */
  offer: CycleOffer | null;
  /** 1-based "Offer N". */
  offerNumber: number | null;
  /** Suggested subject line, product filled. */
  subject: string;
  /** Suggested Klaviyo campaign name, product filled. */
  campaignName: string;
  /** Free slot only: the idea ("Vote on our next flavour"). */
  idea: string | null;
}

/** Days whose cycle email was deleted from the plan: a deleted row holds
 *  the day (cycle_date) and no live row has taken it back. */
export function removedCycleDays(rows: ReadonlyArray<{ cycleDate: string | null; deleted: boolean }>): string[] {
  const live = new Set(rows.filter(r => !r.deleted && r.cycleDate).map(r => r.cycleDate!));
  const out = new Set<string>();
  for (const r of rows) if (r.deleted && r.cycleDate && !live.has(r.cycleDate)) out.add(r.cycleDate);
  return [...out].sort();
}

/** The cycle's emails for the week starting `monday` (index = weekday). */
export function cycleSlotsForWeek(monday: string, config: CycleConfig, product?: string | null): Array<CycleSlot | null> {
  const week = startOfWeek(monday);
  const days: Array<CycleSlot | null> = Array(7).fill(null);
  if (weekPause(week, config) || week < startOfWeek(config.startDate)) return days;
  const oi = offerIndexForWeek(week, config);
  const offer = oi == null ? null : config.offers[oi];
  const idea = freeIdeaForWeek(week, config);
  for (let i = 0; i < 7; i++) {
    const type = config.weeklyPlan[i];
    if (!type) continue;
    const date = addDays(week, i);
    if (pauseOn(date, config.pauses)) continue;
    if (config.removedDays?.includes(date)) continue;
    if (type === "free_slot") {
      const ideaText = idea?.idea ?? "Random or creative email";
      days[i] = {
        date, weekday: i, type, offer, offerNumber: oi == null ? null : oi + 1,
        subject: idea?.subject ?? "Free slot: random or creative email",
        campaignName: freeSlotCampaignName(date, ideaText),
        idea: ideaText,
      };
      continue;
    }
    if (!offer) continue;
    const p = offer.featuresProduct ? product : null;
    days[i] = {
      date, weekday: i, type, offer, offerNumber: oi! + 1,
      subject: fillProduct(offer.subjects[type] ?? `${offer.name} – ${EMAIL_TYPE_LABELS[type]}`, p),
      campaignName: cycleCampaignName(date, offer.code, type, p),
      idea: null,
    };
  }
  return days;
}

/** Every cycle slot from `from` to `to` (inclusive). */
export function cycleSlotsBetween(from: string, to: string, config: CycleConfig, products: Readonly<Record<string, string | null>> = {}): CycleSlot[] {
  const out: CycleSlot[] = [];
  for (let monday = startOfWeek(from); monday <= to; monday = addDays(monday, 7)) {
    for (const s of cycleSlotsForWeek(monday, config, products[monday] ?? null)) {
      if (s && s.date >= from && s.date <= to) out.push(s);
    }
  }
  return out;
}

/** The slot on one day, or null (no cycle email that day). */
export function cycleSlotOn(date: string, config: CycleConfig, product?: string | null): CycleSlot | null {
  return cycleSlotsForWeek(startOfWeek(date), config, product)[mondayIndex(date)];
}

// ── The List view: weeks of day rows ────────────────────────────────────────
export interface PlannedForList {
  id: number;
  sendDate: string;
  sendTime: string | null;
  subject: string;
  status: string;
  klaviyoCampaignId: string | null;
  campaignTitle: string | null;
  cycleDate: string | null;
  emailType: string | null;
  campaignName: string | null;
  skipped: boolean;
}
export interface KlaviyoForList { id: string; name: string; status: string; date: string; sendAt: string; subject: string | null }
export interface ResultForList { campaignId: string; recipients: number; openRate: number; clickRate: number; orders: number; revenue: number }

export type ListRow<P, K> =
  | {
    kind: "email";
    key: string;
    date: string;
    /** The cycle slot this row is (or replaced), if any. */
    slot: CycleSlot | null;
    /** Stored planned email (null = the cycle idea, not stored yet). */
    planned: P | null;
    /** Its Klaviyo campaign, when linked and known. */
    klaviyo: K | null;
    type: EmailTypeKey | null;
    subject: string;
    campaignName: string;
    /** Scheduled or sent — in Klaviyo, or ticked by hand. */
    scheduled: boolean;
    /** Set automatically from Klaviyo (the tick can't be undone by hand). */
    scheduledByKlaviyo: boolean;
    /** Drafted in Klaviyo (Graeme, 2026-10-15): ticked by hand (stage
     *  'created'), or automatically once it's linked to a Klaviyo campaign —
     *  and always true once scheduled or sent. */
    drafted: boolean;
    draftedByKlaviyo: boolean;
    skipped: boolean;
    result: ResultForList | null;
  }
  | { kind: "unplanned"; key: string; date: string; klaviyo: K; result: ResultForList | null }
  | { kind: "moved"; key: string; date: string; slot: CycleSlot; planned: P };

export interface ListDay<P, K> {
  date: string;
  weekday: number;
  isToday: boolean;
  keyDates: KeyDate[];
  rows: Array<ListRow<P, K>>;
}

export interface ListWeek<P, K> {
  monday: string;
  sunday: string;
  isThisWeek: boolean;
  pause: CyclePause | null;
  offer: CycleOffer | null;
  offerNumber: number | null;
  /** The week's product (offers that feature one). */
  product: string | null;
  days: Array<ListDay<P, K>>;
  /** Email rows (not skipped) and how many are scheduled or sent. */
  total: number;
  done: number;
  /** From Klaviyo results of this week's emails. */
  orders: number;
  revenue: number;
  hasResults: boolean;
  /** Big key dates in a running (not paused) week — "check the offer". */
  bigKeyDates: string[];
  /** Phases (calendar campaigns) the week's planned emails belong to. */
  phases: string[];
}

const KLAVIYO_SCHEDULED = new Set(["Scheduled", "Sending", "Sent"]);

function byTimeThenId<P extends PlannedForList>(a: P, b: P): number {
  return (a.sendTime ?? "99:99").localeCompare(b.sendTime ?? "99:99") || a.id - b.id;
}

export function buildEmailWeeks<P extends PlannedForList, K extends KlaviyoForList>(input: {
  config: CycleConfig;
  /** First Monday shown. */
  firstMonday: string;
  weeks: number;
  planned: readonly P[];
  klaviyo: readonly K[];
  /** Campaign ids linked to ANY live plan (even outside the range). */
  linkedCampaignIds?: Iterable<string>;
  results?: ReadonlyMap<string, ResultForList>;
  keyDates?: readonly KeyDate[];
  products?: Readonly<Record<string, string | null>>;
  today: string;
}): Array<ListWeek<P, K>> {
  const { config, planned, klaviyo, today } = input;
  const products = input.products ?? {};
  const results = input.results ?? new Map<string, ResultForList>();
  const keyDates = input.keyDates ?? [];
  const kById = new Map(klaviyo.map(k => [k.id, k]));
  const linked = new Set<string>(input.linkedCampaignIds ?? []);
  for (const p of planned) if (p.klaviyoCampaignId) linked.add(p.klaviyoCampaignId);
  const plannedByDay = new Map<string, P[]>();
  for (const p of planned) (plannedByDay.get(p.sendDate) ?? plannedByDay.set(p.sendDate, []).get(p.sendDate)!).push(p);
  for (const list of plannedByDay.values()) list.sort(byTimeThenId);
  const bySlotDay = new Map<string, P>();
  for (const p of planned) if (p.cycleDate) bySlotDay.set(p.cycleDate, p);
  const thisMonday = startOfWeek(today);

  const weeks: Array<ListWeek<P, K>> = [];
  const first = startOfWeek(input.firstMonday);
  for (let w = 0; w < input.weeks; w++) {
    const monday = addDays(first, w * 7);
    const pause = weekPause(monday, config);
    const oi = pause ? null : offerIndexForWeek(monday, config);
    const offer = oi == null ? null : config.offers[oi];
    const product = (products[monday] ?? "").trim() || null;
    const slots = cycleSlotsForWeek(monday, config, product);
    const days: Array<ListDay<P, K>> = [];
    let total = 0, done = 0, orders = 0, revenue = 0, hasResults = false;
    const phases = new Set<string>();
    const bigKeyDates: string[] = [];

    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      const rows: Array<ListRow<P, K>> = [];
      const dayPlanned = plannedByDay.get(date) ?? [];
      const slot = slots[i];
      let filler: P | null = null;
      if (slot) {
        const own = bySlotDay.get(date) ?? null;
        if (own && own.sendDate !== date) {
          rows.push({ kind: "moved", key: `moved-${date}`, date, slot, planned: own });
        } else {
          filler = own ?? dayPlanned.find(p => !p.cycleDate) ?? null;
          rows.push(emailRow(date, slot, filler));
        }
      }
      for (const p of dayPlanned) if (p !== filler) rows.push(emailRow(date, null, p));
      for (const k of klaviyo) {
        if (k.date !== date || linked.has(k.id)) continue;
        rows.push({ kind: "unplanned", key: `k-${k.id}`, date, klaviyo: k, result: results.get(k.id) ?? null });
      }
      for (const r of rows) {
        if (r.kind === "moved") continue;
        if (r.kind === "email") {
          if (r.planned?.campaignTitle) phases.add(r.planned.campaignTitle);
          if (!r.skipped) { total++; if (r.scheduled) done++; }
        }
        if (r.result) { hasResults = true; orders += r.result.orders; revenue += r.result.revenue; }
      }
      const kd = keyDates.filter(k => k.date === date);
      if (!pause) for (const k of kd) if (k.big) bigKeyDates.push(k.name);
      days.push({ date, weekday: i, isToday: date === today, keyDates: kd, rows });
    }
    weeks.push({
      monday, sunday: addDays(monday, 6), isThisWeek: monday === thisMonday, pause, offer,
      offerNumber: oi == null ? null : oi + 1, product,
      days, total, done, orders, revenue: Math.round(revenue * 100) / 100, hasResults, bigKeyDates, phases: [...phases],
    });
  }
  return weeks;

  function emailRow(date: string, slot: CycleSlot | null, p: P | null): ListRow<P, K> {
    const k = p?.klaviyoCampaignId ? kById.get(p.klaviyoCampaignId) ?? null : null;
    const product = (products[startOfWeek(date)] ?? "").trim() || null;
    const fill = (s: string) => fillProduct(s, product);
    const byKlaviyo = k != null && KLAVIYO_SCHEDULED.has(k.status);
    const byHand = p != null && (p.status === "scheduled" || p.status === "sent");
    const draftedByKlaviyo = k != null || p?.klaviyoCampaignId != null;
    const type = p && isEmailType(p.emailType) ? p.emailType : slot?.type ?? null;
    return {
      kind: "email",
      key: p ? `p-${p.id}` : `slot-${date}`,
      date, slot, planned: p, klaviyo: k, type,
      subject: p ? fill(p.subject) : slot!.subject,
      campaignName: fill(p ? p.campaignName ?? (p.cycleDate && slot ? slot.campaignName : plannedCampaignName(date, p.campaignTitle, p.subject)) : slot!.campaignName),
      scheduled: byKlaviyo || byHand,
      scheduledByKlaviyo: byKlaviyo,
      drafted: byKlaviyo || byHand || draftedByKlaviyo || p?.status === "created",
      draftedByKlaviyo,
      skipped: p?.skipped === true,
      result: k ? results.get(k.id) ?? null : null,
    };
  }
}

/** The Monday the list starts on: this week (or the cycle's first week if
 *  that is later), minus any earlier weeks asked for. */
export function listFirstMonday(today: string, startDate: string, earlierWeeks = 0): string {
  const thisMonday = startOfWeek(today);
  const start = startOfWeek(startDate);
  return addDays(start > thisMonday ? start : thisMonday, -7 * Math.max(0, earlierWeeks));
}
