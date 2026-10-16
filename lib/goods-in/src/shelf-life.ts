/**
 * Minimum shelf life at goods-in (Graeme, 2026-10-16). Pure; no database,
 * no React. The receive dialog and the server both use these.
 *
 * "Brakes promise at least 3 days' shelf life on the diced chicken, but it
 * often arrives with 1 day." An ingredient can carry a minimum shelf life on
 * delivery (ingredients.min_delivery_shelf_life_days). At goods-in:
 *
 *   shelf life = use-by day − delivery day, in whole London calendar days.
 *   shelf life < minimum → SHORT.
 *
 * Received 16 Oct with a minimum of 3: a use-by of 17 or 18 Oct is short;
 * 19 Oct is fine. A short line needs the receiver's decision — accept it
 * anyway (we'll use or freeze it) or reject it (not received) — and the
 * supplier's account manager is emailed either way (delivery-issues.ts).
 *
 * Objective D (goods-in checks every time).
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-16" (or a longer ISO string starting with one) → UTC midnight ms. */
function dayMs(iso: string): number | null {
  const m = ISO_DAY.exec(String(iso).slice(0, 10));
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The London calendar day of a moment, "2026-10-16" — the delivery day is
 *  the London day the goods were received. */
export function londonDeliveryDay(at: Date | string | number = new Date()): string {
  const d = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** Whole calendar days from the delivery day to the use-by day (17 Oct
 *  use-by on a 16 Oct delivery = 1). Null when either date is unreadable. */
export function shelfLifeDaysOnDelivery(deliveryDate: string, useByDate: string): number | null {
  const d = dayMs(deliveryDate);
  const u = dayMs(useByDate);
  if (d == null || u == null) return null;
  return Math.round((u - d) / 86_400_000);
}

/** The minimum as a usable whole number of days, or null for "no minimum". */
export function normaliseMinShelfLife(min: number | string | null | undefined): number | null {
  if (min == null || min === "") return null;
  const n = Math.floor(Number(min));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface ShelfLifeCheck {
  /** Use-by day − delivery day. */
  days: number;
  minDays: number;
  short: boolean;
  /** How many days short of the minimum (0 when fine). */
  daysShort: number;
  /** The earliest use-by that would have been fine. */
  earliestOkUseBy: string;
}

/** Null when there's nothing to check: no minimum, no use-by, or a date that
 *  can't be read. */
export function checkShelfLife(input: {
  deliveryDate: string;
  useByDate: string | null | undefined;
  minDays: number | string | null | undefined;
}): ShelfLifeCheck | null {
  const minDays = normaliseMinShelfLife(input.minDays);
  if (minDays == null || !input.useByDate) return null;
  const days = shelfLifeDaysOnDelivery(input.deliveryDate, input.useByDate);
  const d = dayMs(input.deliveryDate);
  if (days == null || d == null) return null;
  const short = days < minDays;
  return {
    days,
    minDays,
    short,
    daysShort: short ? minDays - days : 0,
    earliestOkUseBy: isoOf(d + minDays * 86_400_000),
  };
}

/** "Mon 19 Oct". */
export function shortDayLabel(iso: string): string {
  const ms = dayMs(iso);
  if (ms == null) return iso;
  const dt = new Date(ms);
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

/** "Fri 16 Oct 2026". */
export function longDayLabel(iso: string): string {
  const ms = dayMs(iso);
  if (ms == null) return iso;
  return `${shortDayLabel(iso)} ${new Date(ms).getUTCFullYear()}`;
}

function daysPhrase(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/** What the shelf life amounts to, in words: "1 day", "goes out of date
 *  today", "already out of date". */
export function shelfLifePhrase(days: number): string {
  if (days < 0) return "already out of date";
  if (days === 0) return "goes out of date today";
  return daysPhrase(days);
}

/** The big red line on the receive dialog:
 *  "Only 1 day's shelf life — Brakes promise at least 3 days (use-by should
 *  be Mon 19 Oct or later)". */
export function shelfLifeWarningText(check: ShelfLifeCheck, supplierName: string | null | undefined): string {
  const who = supplierName?.trim() || "The supplier";
  const head = check.days < 0
    ? "Already out of date"
    : check.days === 0
    ? "Goes out of date today"
    : `Only ${check.days} day${check.days === 1 ? "'s" : "s'"} shelf life`;
  return `${head} — ${who} promise at least ${daysPhrase(check.minDays)} (use-by should be ${shortDayLabel(check.earliestOkUseBy)} or later)`;
}

// ── The decision ───────────────────────────────────────────────────────────

export type ShelfLifeDecision = "accepted" | "rejected";

// The supplier email is one per delivery receive, covering every issue line
// with the photos attached: delivery-issues.ts deliveryIssueReportEmail.

// ── Which lines are reported, and how the receiver is told ────────────────

/** What a saved line means for the shelf-life report. The server decides
 *  from what was actually saved, not from what the screen claims:
 *    - received (> 0) with a short use-by → ACCEPTED, whatever was tapped;
 *    - received 0, and the screen says it was rejected for its shelf life
 *      with a use-by that is indeed short → REJECTED;
 *    - anything else → nothing to report (null). */
export function shelfLifeReportFor(input: {
  deliveryDate: string;
  minDays: number | string | null | undefined;
  quantityReceived: number;
  /** The use-by saved on the line (received lines). */
  useByDate?: string | null;
  /** The screen's "Reject it" — with the use-by the receiver saw. */
  rejected?: { useByDate: string | null | undefined } | null;
}): { decision: ShelfLifeDecision; check: ShelfLifeCheck; useByDate: string } | null {
  if (input.quantityReceived > 0) {
    const check = checkShelfLife({ deliveryDate: input.deliveryDate, useByDate: input.useByDate, minDays: input.minDays });
    return check?.short ? { decision: "accepted", check, useByDate: input.useByDate! } : null;
  }
  if (input.rejected) {
    const check = checkShelfLife({ deliveryDate: input.deliveryDate, useByDate: input.rejected.useByDate, minDays: input.minDays });
    return check?.short ? { decision: "rejected", check, useByDate: input.rejected.useByDate! } : null;
  }
  return null;
}
