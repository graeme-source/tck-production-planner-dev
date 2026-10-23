/**
 * When may an order's EXISTING APC consignment be reused? (Graeme, 19 Oct 2026)
 *
 * Pure rules — no database, no network. The database half is
 * apc-consignment-ledger.ts; the daily check is apc-consignment-check.ts.
 *
 * Incident #136845: booked on 7 Oct, cancelled in APC at 14:43 that day when
 * the order moved to the 16th, but our ledger row was never marked cancelled.
 * On 15 Oct the packing screen saw "this order already has a consignment",
 * booked nothing new, printed the dead label and pushed the dead waybill to
 * Shopify. APC disposed of the parcel on 19 Oct.
 *
 * The rule now:
 *   an existing consignment is reused ONLY when it is for TODAY's collection
 *   (London date), is for the delivery date the order is on now, and is
 *   neither cancelled nor superseded — and, where APC can be asked, its
 *   tracking has never shown CANCELLED / DISPOSED OF.
 * Anything else: ignore it and book a new consignment through the normal
 * booking path.
 */
import { londonDateString } from "./london-time";
import { trackingFallbackNotice } from "./apc-tracking-cache";

/** YYYY-MM-DD */
export type IsoDate = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function validIso(y: number, m: number, d: number): IsoDate | null {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** APC's send date from a 22-digit waybill (its leading 8 digits, YYYYMMDD),
 *  e.g. 2026100703036990019775 → 2026-10-07. Null when it isn't one. */
export function waybillSendDate(waybill: string | null | undefined): IsoDate | null {
  const digits = (waybill ?? "").trim();
  if (!/^\d{22}$/.test(digits)) return null;
  return validIso(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)));
}

/** "07/10/2026" (APC's DD/MM/YYYY, optionally with a time) → "2026-10-07". */
export function apcDateToIso(s: string | null | undefined): IsoDate | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec((s ?? "").trim());
  if (!m) return null;
  return validIso(Number(m[3]), Number(m[2]), Number(m[1]));
}

/** "15/10/2026 21:20:15" → a sortable "2026-10-15T21:20:15" (APC's local
 *  time, which is UK time — only ever compared with other APC times). */
export function apcDateTimeSortKey(s: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec((s ?? "").trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}`;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The London calendar date of an instant. */
export function londonDateOf(v: Date | string | null | undefined): IsoDate | null {
  const d = toDate(v);
  return d ? londonDateString(d) : null;
}

/** One ledger row, as far as these rules care. */
export interface LedgerConsignment {
  waybill: string;
  /** Stored collection date (migration 0205). */
  collectionDate: IsoDate | null;
  createdAt: Date | string | null;
  /** The delivery-date tag the booking was made under, when known. */
  dispatchTag: string | null;
  cancelledAt: Date | string | null;
  supersededAt: Date | string | null;
}

/** The day APC collects this consignment: the stored date, else the
 *  waybill's own send date, else the London date the row was created. */
export function collectionDateOf(c: Pick<LedgerConsignment, "waybill" | "collectionDate" | "createdAt">): IsoDate | null {
  if (c.collectionDate && ISO_RE.test(c.collectionDate.slice(0, 10))) return c.collectionDate.slice(0, 10);
  return waybillSendDate(c.waybill) ?? londonDateOf(c.createdAt);
}

/** "Tue 7 Oct" for messages people read. */
export function friendlyIsoDate(iso: IsoDate | null): string {
  if (!iso || !ISO_RE.test(iso)) return "an unknown day";
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export type ReuseReason =
  | "no-consignment"
  | "cancelled"
  | "superseded"
  | "not-today"
  | "other-delivery-date"
  | "dead-in-apc";

export type ReuseDecision =
  | {
      action: "reuse";
      waybill: string;
      collectionDate: IsoDate;
      /** Set when APC couldn't be asked and only the date rule was applied —
       *  a quiet grey line on the packing screen, not an amber warning
       *  (issue #339). */
      notice?: string;
    }
  | {
      action: "book-new";
      reason: ReuseReason;
      /** The consignment that was NOT reused (null when there was none). */
      waybill: string | null;
      collectionDate: IsoDate | null;
      message: string;
      /** What the caller must do to the old row so it is never reused:
       *  supersede it (still possibly live in APC — a manager is asked
       *  whether to cancel it), mark it cancelled (APC says it's dead), or
       *  nothing (already retired / no row). */
      retire: "supersede" | "cancel" | null;
    };

export interface ReuseContext {
  /** Today's London date — the current dispatch (collection) day. */
  today: IsoDate;
  /** The delivery-date tag the order carries NOW (YYYY-MM-DD), if any. */
  orderDateTag: string | null;
}

/**
 * The date-and-ledger half of the rule. Decides from our own row alone; the
 * live APC check (applyLiveStatus) runs afterwards, only on a "reuse".
 */
export function decideConsignmentReuse(c: LedgerConsignment | null, ctx: ReuseContext): ReuseDecision {
  if (!c || !c.waybill) {
    return { action: "book-new", reason: "no-consignment", waybill: null, collectionDate: null, message: "No existing consignment.", retire: null };
  }
  const collectionDate = collectionDateOf(c);
  if (c.cancelledAt) {
    return {
      action: "book-new", reason: "cancelled", waybill: c.waybill, collectionDate,
      message: `Old APC booking ${c.waybill} is marked cancelled — booking a new one.`,
      retire: null,
    };
  }
  if (c.supersededAt) {
    return {
      action: "book-new", reason: "superseded", waybill: c.waybill, collectionDate,
      message: `Old APC booking ${c.waybill} was replaced when the order changed date — booking a new one.`,
      retire: null,
    };
  }
  if (collectionDate !== ctx.today) {
    return {
      action: "book-new", reason: "not-today", waybill: c.waybill, collectionDate,
      message: `Old APC booking ${c.waybill} was for collection on ${friendlyIsoDate(collectionDate)}, not today — booking a new one.`,
      retire: "supersede",
    };
  }
  const tag = ctx.orderDateTag && ISO_RE.test(ctx.orderDateTag) ? ctx.orderDateTag : null;
  const bookedTag = c.dispatchTag && ISO_RE.test(c.dispatchTag) ? c.dispatchTag : null;
  if (tag && bookedTag && tag !== bookedTag) {
    return {
      action: "book-new", reason: "other-delivery-date", waybill: c.waybill, collectionDate,
      message: `APC booking ${c.waybill} was made for delivery on ${friendlyIsoDate(bookedTag)}, but the order is now for ${friendlyIsoDate(tag)} — booking a new one.`,
      retire: "supersede",
    };
  }
  return { action: "reuse", waybill: c.waybill, collectionDate };
}

/** The short reason stored on a row this rule retires (superseded_reason),
 *  read later on the check page and in the packer's refusal message. */
export function retireReasonFor(d: ReuseDecision, ctx: ReuseContext): string {
  if (d.action !== "book-new") return "";
  switch (d.reason) {
    case "not-today": return `booked for collection on ${friendlyIsoDate(d.collectionDate)}, not reused on ${friendlyIsoDate(ctx.today)}`;
    case "other-delivery-date": return `booked for a different delivery date than ${friendlyIsoDate(ctx.orderDateTag)}`;
    case "dead-in-apc": return "cancelled in APC";
    default: return d.message;
  }
}

/** Pick from all of an order's not-yet-retired rows (newest first): the
 *  newest that may be reused, plus every row that must be retired. */
export function decideAcrossRows(rows: LedgerConsignment[], ctx: ReuseContext): {
  decision: ReuseDecision;
  retire: Array<{ waybill: string; how: "supersede" | "cancel"; message: string }>;
} {
  const retire: Array<{ waybill: string; how: "supersede" | "cancel"; message: string }> = [];
  let firstRefusal: ReuseDecision | null = null;
  let reuse: ReuseDecision | null = null;
  for (const row of rows) {
    const d = decideConsignmentReuse(row, ctx);
    if (d.action === "reuse") {
      if (!reuse) reuse = d;
      continue;
    }
    if (d.retire) retire.push({ waybill: row.waybill, how: d.retire, message: retireReasonFor(d, ctx) });
    if (!firstRefusal) firstRefusal = d;
  }
  if (reuse) return { decision: reuse, retire };
  return { decision: firstRefusal ?? decideConsignmentReuse(null, ctx), retire };
}

// ── APC tracking ──────────────────────────────────────────────────────────

export interface TrackingEvent {
  /** Sortable APC local time, "2026-10-07T14:43:55". */
  at: string | null;
  /** As APC sent it, "07/10/2026 14:43:55". */
  dateTime: string | null;
  code: string | null;
  description: string | null;
}

export interface ParsedTracking {
  found: boolean;
  /** Track.CollectionDate, when APC sends it. */
  collectionDate: IsoDate | null;
  events: TrackingEvent[];
}

/**
 * Pull every status event out of a Tracks/{waybill}.json response.
 *
 * Shape (live, 19 Oct 2026): Tracks.Track (object, or array for several) →
 * ShipmentDetails.Items[] → Item → Activity[] → Status {DateTime, StatusCode,
 * StatusDescription, …}. Walked recursively rather than by path so a single
 * object where an array is expected (APC does that) can't hide an event.
 */
export function parseTrackingResponse(json: unknown): ParsedTracking {
  const events: TrackingEvent[] = [];
  let collectionDate: IsoDate | null = null;
  let found = false;
  const seen = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (depth > 12 || node == null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) walk(n, depth + 1); return; }
    const o = node as Record<string, unknown>;
    if (typeof o.WayBill === "string" && o.WayBill) found = true;
    if (!collectionDate && typeof o.CollectionDate === "string") collectionDate = apcDateToIso(o.CollectionDate);
    if (("StatusCode" in o || "StatusDescription" in o) && ("DateTime" in o)) {
      const code = o.StatusCode == null ? null : String(o.StatusCode).trim();
      const description = o.StatusDescription == null ? null : String(o.StatusDescription).trim();
      const dateTime = o.DateTime == null ? null : String(o.DateTime).trim();
      const key = `${dateTime}|${code}|${description}`;
      if (!seen.has(key)) {
        seen.add(key);
        events.push({ at: apcDateTimeSortKey(dateTime), dateTime, code, description });
      }
      return;
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(json, 0);
  if (events.length > 0) found = true;
  events.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  return { found, collectionDate, events };
}

/** APC statuses after which a consignment is finished for good: CANCELLED,
 *  DISPOSED OF, and Parcelly's cancelled consignment (guide §10.4). */
export const DEAD_STATUS_CODES: ReadonlySet<string> = new Set(["97", "149", "151"]);

export function isDeadEvent(e: TrackingEvent): boolean {
  if (e.code && DEAD_STATUS_CODES.has(e.code)) return true;
  return /\bCANCELL?ED\b|\bDISPOSED\b/i.test(e.description ?? "");
}

/**
 * Is this consignment dead? ANY dead event counts, not just the latest:
 * #136845's history reads CANCELLED (7 Oct) → AT HUB (15 Oct) → DISPOSED OF
 * (19 Oct). A parcel scanned at the hub after cancellation is still on a
 * cancelled consignment — the latest status alone said "AT HUB".
 */
export function judgeTracking(events: TrackingEvent[]): {
  dead: boolean;
  deadEvent: TrackingEvent | null;
  latest: TrackingEvent | null;
} {
  const latest = events.length ? events[events.length - 1] : null;
  const deadEvent = events.find(isDeadEvent) ?? null;
  return { dead: !!deadEvent, deadEvent, latest };
}

export type LiveStatus =
  | { kind: "ok"; dead: boolean; deadEvent: TrackingEvent | null; latest: TrackingEvent | null; collectionDate: IsoDate | null }
  | { kind: "not-found" }
  | { kind: "unreachable"; error: string };

export function liveStatusFromTracking(parsed: ParsedTracking): LiveStatus {
  if (!parsed.found) return { kind: "not-found" };
  const j = judgeTracking(parsed.events);
  return { kind: "ok", ...j, collectionDate: parsed.collectionDate };
}

function describeEvent(e: TrackingEvent | null): string {
  if (!e) return "";
  return `${e.description ?? `status ${e.code}`}${e.dateTime ? ` (${e.dateTime})` : ""}`;
}

/**
 * The live half of the rule, applied to a "reuse" only. APC down never
 * blocks packing: the decision stands on the date rule and says so.
 */
export function applyLiveStatus(decision: ReuseDecision, status: LiveStatus, ctx: ReuseContext): ReuseDecision {
  if (decision.action !== "reuse") return decision;
  if (status.kind === "unreachable") {
    return { ...decision, notice: trackingFallbackNotice(status.error) };
  }
  if (status.kind === "not-found") {
    // A consignment booked minutes ago can have no tracking yet.
    return decision;
  }
  if (status.dead) {
    return {
      action: "book-new", reason: "dead-in-apc", waybill: decision.waybill, collectionDate: decision.collectionDate,
      message: `APC says booking ${decision.waybill} is ${describeEvent(status.deadEvent)} — booking a new one.`,
      retire: "cancel",
    };
  }
  if (status.collectionDate && status.collectionDate !== ctx.today) {
    return {
      action: "book-new", reason: "not-today", waybill: decision.waybill, collectionDate: status.collectionDate,
      message: `APC has booking ${decision.waybill} down for collection on ${friendlyIsoDate(status.collectionDate)}, not today — booking a new one.`,
      retire: "supersede",
    };
  }
  return decision;
}

// ── Push / print guard ────────────────────────────────────────────────────

/**
 * Should this waybill be refused at the point of printing its label or
 * pushing it to Shopify? Null = fine. Uses our ledger row when there is one,
 * otherwise the waybill's own send date. Never needs APC.
 */
export function staleWaybillProblem(
  waybill: string,
  row: (LedgerConsignment & { supersededReason?: string | null; cancelledReason?: string | null }) | null,
  today: IsoDate,
): string | null {
  const collection = row ? collectionDateOf(row) : waybillSendDate(waybill);
  const reopen = "Close this order and open it again to get today's label, and bin the old label.";
  if (row?.cancelledAt) {
    return `APC booking ${waybill} is cancelled${row.cancelledReason ? ` (${row.cancelledReason})` : ""} — it can't be shipped or sent to the customer. ${reopen}`;
  }
  if (row?.supersededAt) {
    return `APC booking ${waybill} was replaced${row.supersededReason ? ` (${row.supersededReason})` : ""} — it can't be shipped or sent to the customer. ${reopen}`;
  }
  if (collection && collection !== today) {
    return `APC booking ${waybill} was for collection on ${friendlyIsoDate(collection)}, not today — it can't be shipped or sent to the customer. ${reopen}`;
  }
  return null;
}

// ── Daily mismatch check ──────────────────────────────────────────────────

export interface UsedConsignmentRow extends LedgerConsignment {
  orderId: number | null;
  orderName: string | null;
  pushedToShopifyAt: Date | string | null;
  labelPrintedAt: Date | string | null;
  apcStatus: string | null;
  apcDeadStatus: string | null;
}

export type MismatchKind = "collected-other-day" | "dead-in-apc" | "retired-in-ledger";

/** The day the consignment was actually used — pushed to Shopify, else
 *  label printed. That is the order's real dispatch day. */
export function usedDateOf(row: Pick<UsedConsignmentRow, "pushedToShopifyAt" | "labelPrintedAt">): IsoDate | null {
  return londonDateOf(row.pushedToShopifyAt) ?? londonDateOf(row.labelPrintedAt);
}

export function consignmentMismatches(row: UsedConsignmentRow): MismatchKind[] {
  const out: MismatchKind[] = [];
  const used = usedDateOf(row);
  const collection = collectionDateOf(row);
  if (used && collection && used !== collection) out.push("collected-other-day");
  if (row.apcDeadStatus) out.push("dead-in-apc");
  const pushed = toDate(row.pushedToShopifyAt);
  const retiredAt = toDate(row.cancelledAt) ?? toDate(row.supersededAt);
  if (pushed && retiredAt && retiredAt.getTime() <= pushed.getTime()) out.push("retired-in-ledger");
  return out;
}

export function mismatchLabel(kind: MismatchKind): string {
  switch (kind) {
    case "collected-other-day": return "Booked for a different collection day";
    case "dead-in-apc": return "Cancelled or disposed of in APC";
    case "retired-in-ledger": return "Sent to Shopify after we marked it cancelled/replaced";
  }
}

/** One plain line for Graeme's bell. */
export function mismatchNotificationText(rows: Array<{ orderName: string | null; waybill: string }>): string {
  const names = rows.map(r => r.orderName ?? r.waybill);
  const shown = names.slice(0, 4).join(", ");
  const more = names.length > 4 ? ` and ${names.length - 4} more` : "";
  const n = rows.length;
  return `APC check: ${n} order${n === 1 ? "" : "s"} went out on an old or cancelled APC booking — ${shown}${more}. Open the APC consignment check.`;
}
