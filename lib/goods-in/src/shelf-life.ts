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
 * supplier's account manager is emailed either way (shelfLifeReportEmail).
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

// ── The email to the supplier ──────────────────────────────────────────────

export type ShelfLifeDecision = "accepted" | "rejected";

export interface ShelfLifeReportInput {
  supplierName: string;
  /** The supplier's account manager's name, for "Dear …". */
  recipientName?: string | null;
  /** Our order number (the purchase order id). */
  orderNumber: number | string;
  deliveryDate: string;
  productName: string;
  /** "20 kg", "4 packs" — already formatted. */
  quantityText: string;
  useByDate: string;
  days: number;
  minDays: number;
  decision: ShelfLifeDecision;
  /** Who made the call at the door. */
  receivedByName?: string | null;
}

export interface ShelfLifeEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstName(name: string | null | undefined): string | null {
  const n = name?.trim();
  if (!n) return null;
  return n.split(/\s+/)[0] ?? null;
}

/** Plain, polite, factual: what arrived, how much shelf life it had against
 *  the minimum promised, and what we did with it. From The Calzone Kitchen. */
export function shelfLifeReportEmail(r: ShelfLifeReportInput): ShelfLifeEmail {
  const greeting = firstName(r.recipientName) ? `Dear ${firstName(r.recipientName)},` : "Hello,";
  const outcome = r.decision === "accepted"
    ? "We accepted it so as not to go without, and will use it or freeze it before the use-by date."
    : "We rejected it, so it has not been received into our stock.";
  const subject = `Short shelf life on delivery — ${r.productName} — ${shortDayLabel(r.deliveryDate)} (our order #${r.orderNumber})`;
  const facts: Array<[string, string]> = [
    ["Supplier", r.supplierName],
    ["Our order number", `#${r.orderNumber}`],
    ["Delivery date", longDayLabel(r.deliveryDate)],
    ["Product", r.productName],
    ["Quantity", r.quantityText],
    ["Use-by date received", longDayLabel(r.useByDate)],
    ["Shelf life on arrival", shelfLifePhrase(r.days)],
    ["Minimum shelf life agreed", daysPhrase(r.minDays)],
    ["What we did", r.decision === "accepted" ? "Accepted (to be used or frozen)" : "Rejected"],
  ];
  if (r.receivedByName?.trim()) facts.push(["Checked in by", r.receivedByName.trim()]);

  const intro = `The ${r.productName} delivered to us on ${longDayLabel(r.deliveryDate)} arrived with ${
    r.days < 0 ? "a use-by date that had already passed" : r.days === 0 ? "a use-by date of that same day" : `only ${daysPhrase(r.days)} of shelf life`
  }. We were promised at least ${daysPhrase(r.minDays)}.`;
  const ask = "Please could you look into this and let us know what will be done to make sure future deliveries meet the agreed minimum shelf life.";
  const signOff = ["Kind regards,", "The Calzone Kitchen"];

  const text = [
    greeting,
    "",
    intro,
    "",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    "",
    outcome,
    "",
    ask,
    "",
    ...signOff,
    "",
    "(This report was sent automatically from our goods-in check.)",
  ].join("\n");

  const rows = facts
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top;">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(v)}</td></tr>`)
    .join("");
  const html = `<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: 24px auto; color: #222; line-height: 1.45;">
  <p>${escapeHtml(greeting)}</p>
  <p>${escapeHtml(intro)}</p>
  <table style="border-collapse:collapse;margin:12px 0;">${rows}</table>
  <p>${escapeHtml(outcome)}</p>
  <p>${escapeHtml(ask)}</p>
  <p>${signOff.map(escapeHtml).join("<br>")}</p>
  <p style="color:#888;font-size:12px;">This report was sent automatically from our goods-in check.</p>
</body>
</html>`;

  return { subject, text, html };
}

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

export type ShelfLifeEmailStatus = "pending" | "sent" | "failed" | "no_address" | "skipped";

/** One reported line, as the server hands it back to the receive dialog. */
export interface ShelfLifeReportOutcome {
  lineId: number;
  ingredientName: string;
  supplierName: string;
  decision: ShelfLifeDecision;
  emailStatus: ShelfLifeEmailStatus;
  /** The account manager's name, when there is one. */
  recipientName: string | null;
  /** True when this line was already reported on an earlier save. */
  alreadyReported: boolean;
}

/** The confirmation the receiver sees: "Emailed James Clarke at Brakes
 *  automatically" — or what went wrong, so someone else can tell them. */
export function shelfLifeToldText(o: ShelfLifeReportOutcome): { ok: boolean; text: string } {
  const at = o.supplierName || "the supplier";
  const who = o.recipientName?.trim() ? `${o.recipientName.trim()} at ${at}` : at;
  if (o.alreadyReported) return { ok: true, text: `${at} were already told about the ${o.ingredientName}.` };
  switch (o.emailStatus) {
    case "sent":
      return { ok: true, text: `Emailed ${who} automatically about the ${o.ingredientName}.` };
    case "no_address":
      return { ok: false, text: `${at} have no account manager email set, so they weren't told about the ${o.ingredientName}. Add it on the supplier's record and tell a manager.` };
    case "skipped":
      return { ok: false, text: `Email to ${at} not sent — this copy of the app doesn't send emails. The decision on the ${o.ingredientName} is recorded.` };
    default:
      return { ok: false, text: `Couldn't email ${who} about the ${o.ingredientName}. The decision is recorded — tell a manager so they can let ${at} know.` };
  }
}
