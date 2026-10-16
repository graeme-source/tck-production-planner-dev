/**
 * Delivery issues reported to the supplier, with photos (Graeme, 2026-10-16).
 * Pure; no database, no React. The receive dialog and the server both use
 * these. Objective D (goods-in checks every time) and C (stock stays right).
 *
 * "Today 8 bags of chicken with use-by the 17th came in; I took one picture
 * of all 8 bags showing the date and sent it to the account manager James.
 * Make that the process." And the same for broken or damaged items.
 *
 * An ISSUE LINE is a receive line that is either
 *   - short shelf life (accepted anyway, or rejected) — shelf-life.ts, or
 *   - marked Damaged / broken, kept or rejected (damageReportFor).
 *
 * When a receive has any NEW issue line (not reported on an earlier save):
 *   - at least one photo (up to MAX_ISSUE_PHOTOS) of every affected item, its
 *     use-by date or damage showing, must be taken and uploaded, and the
 *     receiver must tick "All 8 packs are in the photo(s) …" (issuePhotoGate —
 *     enforced on the server too; there is no "can't take a photo" escape);
 *   - ONE email to the supplier's account manager lists every new issue line,
 *     with the photos attached (deliveryIssueReportEmail).
 */
import { shortDayLabel, longDayLabel, shelfLifePhrase, type ShelfLifeDecision } from "./shelf-life";

/** Photos per receive — enough for 8 packs that won't fit one shot. */
export const MAX_ISSUE_PHOTOS = 4;

export type DeliveryIssueKind = "short_shelf_life" | "damaged";
export type DamageDisposition = "kept" | "rejected";

// ── Damaged / broken ───────────────────────────────────────────────────────

export interface DamageInput {
  /** How many are damaged, in the line's unit. */
  quantity: number;
  /** Kept (we'll use what we can) or rejected (sent back / not received). */
  disposition: DamageDisposition;
  note?: string | null;
}

/** What the line books in after damage: the damaged quantity comes off what
 *  arrived when it's rejected; kept damage changes nothing. Never below 0. */
export function receivedAfterDamage(arrived: number, damage: DamageInput | null | undefined): number {
  const a = Math.max(0, Number(arrived) || 0);
  if (!damage || damage.disposition !== "rejected") return a;
  const d = Math.max(0, Number(damage.quantity) || 0);
  return Math.max(0, Math.round((a - Math.min(d, a)) * 10000) / 10000);
}

/** The damage the server records for a saved line, or null when there's
 *  nothing real to record: no quantity, or "kept" damage on a line where
 *  nothing was kept. Kept damage can't exceed what was booked in. */
export function damageReportFor(input: {
  /** What was saved as received (after any rejection). */
  quantityReceived: number;
  damage: DamageInput | null | undefined;
}): { quantity: number; disposition: DamageDisposition; note: string | null } | null {
  const d = input.damage;
  if (!d) return null;
  const qty = Number(d.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const received = Math.max(0, Number(input.quantityReceived) || 0);
  const note = d.note?.trim() ? d.note.trim().slice(0, 300) : null;
  if (d.disposition === "kept") {
    if (received <= 0) return null;
    return { quantity: Math.min(qty, received), disposition: "kept", note };
  }
  return { quantity: qty, disposition: "rejected", note };
}

/** Re-opening a saved delivery: the received box shows what ARRIVED, so a
 *  rejected damaged quantity is added back on (it's taken off again when
 *  saved — receivedAfterDamage). A line whose whole delivery was rejected as
 *  damaged was still received at the door, so it reopens as Received. */
export function reopenDamagedLine(input: {
  savedQuantity: number;
  damage: { quantity: number; disposition: DamageDisposition } | null | undefined;
}): { arrived: number; wasReceived: boolean } {
  const saved = Math.max(0, Number(input.savedQuantity) || 0);
  const d = input.damage;
  if (!d || d.disposition !== "rejected") return { arrived: saved, wasReceived: saved > 0 };
  const arrived = saved + Math.max(0, Number(d.quantity) || 0);
  return { arrived, wasReceived: arrived > 0 };
}

// ── Which lines are issues ─────────────────────────────────────────────────

export interface IssueLineFacts {
  lineId: number;
  name: string;
  /** Short shelf life on this line: accepted anyway, rejected, or none. */
  shelfLife: ShelfLifeDecision | null;
  /** Already reported on an earlier save. */
  shelfLifeReported?: boolean;
  damage: DamageInput | null;
  damageReported?: boolean;
  /** "8 packs" — what's affected, for the photo prompt. */
  shelfLifeQuantityText?: string;
  damageQuantityText?: string;
}

export interface IssueLine {
  lineId: number;
  kind: DeliveryIssueKind;
  name: string;
  quantityText: string;
  alreadyReported: boolean;
}

/** Every issue on the receive, one entry per line + kind (a line can be both
 *  short-dated and damaged). */
export function issueLinesOf(lines: IssueLineFacts[]): IssueLine[] {
  const out: IssueLine[] = [];
  for (const l of lines) {
    if (l.shelfLife) {
      out.push({ lineId: l.lineId, kind: "short_shelf_life", name: l.name, quantityText: l.shelfLifeQuantityText ?? "", alreadyReported: !!l.shelfLifeReported });
    }
    if (l.damage && Number(l.damage.quantity) > 0) {
      out.push({ lineId: l.lineId, kind: "damaged", name: l.name, quantityText: l.damageQuantityText ?? "", alreadyReported: !!l.damageReported });
    }
  }
  return out;
}

/** The issues that this save will report (and need the photo). */
export function newIssueLines(issues: IssueLine[]): IssueLine[] {
  return issues.filter(i => !i.alreadyReported);
}

/** "8 packs of Diced Chicken"; without a quantity just the name. */
function itemPhrase(i: Pick<IssueLine, "name" | "quantityText">): string {
  return i.quantityText ? `${i.quantityText} of ${i.name}` : i.name;
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The camera prompt: "Lay out all 8 packs of Diced Chicken so every use-by
 *  date can be read, then take the photo." */
export function photoPromptText(issues: IssueLine[]): string {
  const sl = issues.filter(i => i.kind === "short_shelf_life");
  const dm = issues.filter(i => i.kind === "damaged");
  // A line both short-dated and damaged is one set of items.
  const items = new Map<string, Pick<IssueLine, "name" | "quantityText">>();
  for (const i of [...sl, ...dm]) if (!items.has(`${i.lineId}`)) items.set(`${i.lineId}`, i);
  const all = joinAnd([...items.values()].map(itemPhrase));
  const how = sl.length && dm.length
    ? "so every use-by date and all the damage can be seen"
    : sl.length ? "so every use-by date can be read" : "so all the damage can be seen";
  return `Lay out all ${all} ${how}, then take the photo. Add more photos if they don't all fit in one (up to ${MAX_ISSUE_PHOTOS}).`;
}

/** "2 bags" → "2 damaged bags". */
function damagedPhrase(i: Pick<IssueLine, "name" | "quantityText">): string {
  const m = /^([\d.,]+)\s+(.+)$/.exec(i.quantityText);
  const qty = m ? `${m[1]} damaged ${m[2]}` : i.quantityText ? `damaged ${i.quantityText}` : "damaged";
  return `${qty} of ${i.name}`;
}

/** The tick-box before saving: "All 8 packs of Diced Chicken are in the
 *  photo(s) with their use-by dates showing." */
export function photoConfirmationText(issues: IssueLine[]): string {
  const sl = joinAnd(issues.filter(i => i.kind === "short_shelf_life").map(itemPhrase));
  const dm = joinAnd(issues.filter(i => i.kind === "damaged").map(damagedPhrase));
  if (sl && dm) return `All ${sl} (use-by dates showing) and ${dm} (damage showing) are in the photo(s).`;
  if (sl) return `All ${sl} are in the photo(s) with their use-by dates showing.`;
  if (dm) return `All ${dm} are in the photo(s), with the damage showing.`;
  return "All the affected items are in the photo(s).";
}

// ── The photo gate (client AND server) ─────────────────────────────────────

export interface PhotoGate {
  /** A photo is needed for this save at all. */
  required: boolean;
  ok: boolean;
  /** What's missing, in words, when not ok. */
  message: string | null;
}

/** Saving a receive with any NEW issue line needs at least one uploaded
 *  photo and the "all items are in the photo(s)" tick. Mandatory — there is
 *  no "can't take a photo" way round it (Graeme, 2026-10-16). Re-saving
 *  issues already reported needs nothing new. */
export function issuePhotoGate(input: {
  newIssueCount: number;
  uploadedPhotoCount: number;
  allItemsConfirmed: boolean;
}): PhotoGate {
  if (input.newIssueCount <= 0) return { required: false, ok: true, message: null };
  if (input.uploadedPhotoCount <= 0) {
    return { required: true, ok: false, message: "Take a photo of the affected items to finish receiving this delivery." };
  }
  if (input.uploadedPhotoCount > MAX_ISSUE_PHOTOS) {
    return { required: true, ok: false, message: `Up to ${MAX_ISSUE_PHOTOS} photos — remove one.` };
  }
  if (!input.allItemsConfirmed) {
    return { required: true, ok: false, message: "Tick to confirm every affected item is in the photo(s) to finish receiving this delivery." };
  }
  return { required: true, ok: true, message: null };
}

// ── The one email to the supplier ──────────────────────────────────────────

export type ShelfLifeEmailIssue = {
  kind: "short_shelf_life";
  productName: string;
  /** "20 kg", "8 packs" — already formatted. */
  quantityText: string;
  useByDate: string;
  days: number;
  minDays: number;
  decision: ShelfLifeDecision;
};

export type DamagedEmailIssue = {
  kind: "damaged";
  productName: string;
  quantityText: string;
  note: string | null;
  disposition: DamageDisposition;
};

export type DeliveryEmailIssue = ShelfLifeEmailIssue | DamagedEmailIssue;

export interface DeliveryIssueEmailInput {
  supplierName: string;
  recipientName?: string | null;
  /** Our order number (the purchase order id). */
  orderNumber: number | string;
  deliveryDate: string;
  issues: DeliveryEmailIssue[];
  photoCount: number;
  receivedByName?: string | null;
}

export interface DeliveryIssueEmail {
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

function daysPhrase(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/** One issue as a heading + fact rows. */
function issueBlock(i: DeliveryEmailIssue): { heading: string; facts: Array<[string, string]> } {
  if (i.kind === "short_shelf_life") {
    return {
      heading: `${i.productName} — short shelf life`,
      facts: [
        ["Quantity", i.quantityText],
        ["Use-by date received", longDayLabel(i.useByDate)],
        ["Shelf life on arrival", shelfLifePhrase(i.days)],
        ["Minimum shelf life agreed", daysPhrase(i.minDays)],
        ["What we did", i.decision === "accepted" ? "Accepted (to be used or frozen before the use-by date)" : "Rejected — not received into our stock"],
      ],
    };
  }
  const facts: Array<[string, string]> = [["Quantity damaged", i.quantityText]];
  if (i.note?.trim()) facts.push(["Damage", i.note.trim()]);
  facts.push(["What we did", i.disposition === "kept" ? "Kept (we'll use what we can)" : "Rejected — not received into our stock"]);
  return { heading: `${i.productName} — damaged / broken`, facts };
}

/** "Photo attached showing all 8 packs and their use-by dates." */
export function photoSentenceFor(issues: DeliveryEmailIssue[], photoCount: number): string {
  const sl = issues.filter(i => i.kind === "short_shelf_life");
  const dm = issues.filter(i => i.kind === "damaged");
  const items = joinAnd(issues
    .filter((i, idx) => issues.findIndex(j => j.productName === i.productName) === idx)
    .map(i => (i.quantityText ? `${i.quantityText} of ${i.productName}` : i.productName)));
  const showing = sl.length && dm.length ? "their use-by dates and the damage" : sl.length ? "their use-by dates" : "the damage";
  const head = photoCount === 1 ? "Photo attached" : `${photoCount} photos attached`;
  return `${head} showing all ${items} and ${showing}.`;
}

/** Plain, polite, factual: what arrived, what was wrong with each item, what
 *  we did about it — with the photos attached. From The Calzone Kitchen. */
export function deliveryIssueReportEmail(r: DeliveryIssueEmailInput): DeliveryIssueEmail {
  const greeting = firstName(r.recipientName) ? `Dear ${firstName(r.recipientName)},` : "Hello,";
  const day = shortDayLabel(r.deliveryDate);
  const kinds = new Set(r.issues.map(i => i.kind));
  const label = kinds.size > 1
    ? "Problems with our delivery"
    : kinds.has("damaged") ? "Damaged on delivery" : "Short shelf life on delivery";
  const subject = r.issues.length === 1
    ? `${label} — ${r.issues[0]!.productName} — ${day} (our order #${r.orderNumber})`
    : `${label} — ${r.issues.length} items — ${day} (our order #${r.orderNumber})`;

  const what = kinds.size > 1
    ? "some items arrived short-dated or damaged"
    : kinds.has("damaged") ? (r.issues.length === 1 ? "an item arrived damaged" : "some items arrived damaged")
    : (r.issues.length === 1 ? "an item arrived with less shelf life than agreed" : "some items arrived with less shelf life than agreed");
  const intro = `Our delivery on ${longDayLabel(r.deliveryDate)} (our order #${r.orderNumber}) had a problem: ${what}.`;
  const photo = r.photoCount > 0 ? photoSentenceFor(r.issues, r.photoCount) : "No photo could be attached.";
  const ask = kinds.has("short_shelf_life") && kinds.has("damaged")
    ? "Please could you look into this, let us know what will be done about it, and make sure future deliveries arrive undamaged and meet the agreed minimum shelf life."
    : kinds.has("damaged")
    ? "Please could you look into this and let us know what will be done about it — a credit or replacement for anything we've rejected."
    : "Please could you look into this and let us know what will be done to make sure future deliveries meet the agreed minimum shelf life.";
  const signOff = ["Kind regards,", "The Calzone Kitchen"];
  const blocks = r.issues.map(issueBlock);
  const general: Array<[string, string]> = [
    ["Supplier", r.supplierName],
    ["Our order number", `#${r.orderNumber}`],
    ["Delivery date", longDayLabel(r.deliveryDate)],
  ];
  if (r.receivedByName?.trim()) general.push(["Checked in by", r.receivedByName.trim()]);

  const text = [
    greeting,
    "",
    intro,
    "",
    ...general.map(([k, v]) => `${k}: ${v}`),
    "",
    ...blocks.flatMap(b => [b.heading, ...b.facts.map(([k, v]) => `  ${k}: ${v}`), ""]),
    photo,
    "",
    ask,
    "",
    ...signOff,
    "",
    "(This report was sent automatically from our goods-in check.)",
  ].join("\n");

  const row = ([k, v]: [string, string]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top;">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(v)}</td></tr>`;
  const html = `<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 600px; margin: 24px auto; color: #222; line-height: 1.45;">
  <p>${escapeHtml(greeting)}</p>
  <p>${escapeHtml(intro)}</p>
  <table style="border-collapse:collapse;margin:12px 0;">${general.map(row).join("")}</table>
  ${blocks.map(b => `<h3 style="margin:16px 0 4px;font-size:16px;">${escapeHtml(b.heading)}</h3>
  <table style="border-collapse:collapse;margin:0 0 8px;">${b.facts.map(row).join("")}</table>`).join("\n  ")}
  <p><strong>${escapeHtml(photo)}</strong></p>
  <p>${escapeHtml(ask)}</p>
  <p>${signOff.map(escapeHtml).join("<br>")}</p>
  <p style="color:#888;font-size:12px;">This report was sent automatically from our goods-in check.</p>
</body>
</html>`;

  return { subject, text, html };
}

// ── What the receiver is told ──────────────────────────────────────────────

export type IssueEmailStatus = "pending" | "sent" | "failed" | "no_address" | "skipped";

/** The server's answer for one save: what was reported and whether it went. */
export interface DeliveryIssueOutcome {
  supplierName: string;
  recipientName: string | null;
  /** The issues reported by THIS save (empty = nothing new). */
  reported: Array<{ lineId: number; kind: DeliveryIssueKind; ingredientName: string }>;
  /** Issues already reported on an earlier save, not re-sent. */
  alreadyReported: number;
  /** Null when nothing new was reported. */
  emailStatus: IssueEmailStatus | null;
  emailError: string | null;
  photoCount: number;
}

/** "Emailed James Clarke at Brakes with 2 photos about the Diced Chicken and
 *  the Eggs" — or what went wrong, so someone else can tell them. */
export function issueEmailToldText(o: DeliveryIssueOutcome): { ok: boolean; text: string } | null {
  if (!o.reported.length || !o.emailStatus) return null;
  const at = o.supplierName || "the supplier";
  const who = o.recipientName?.trim() ? `${o.recipientName.trim()} at ${at}` : at;
  const names = [...new Set(o.reported.map(r => r.ingredientName))];
  const about = `the ${joinAnd(names)}`;
  const photos = o.photoCount === 1 ? " with the photo" : o.photoCount > 1 ? ` with ${o.photoCount} photos` : "";
  switch (o.emailStatus) {
    case "sent":
      return { ok: true, text: `Emailed ${who}${photos} about ${about}.` };
    case "no_address":
      return { ok: false, text: `${at} have no account manager email set, so they weren't told about ${about}. Add it on the supplier's record and tell a manager.` };
    case "skipped":
      return { ok: false, text: `Email to ${at} not sent — this copy of the app doesn't send emails. The report on ${about} is recorded.` };
    default:
      return { ok: false, text: `Couldn't email ${who} about ${about}${o.emailError ? ` (${o.emailError})` : ""}. The report is recorded — tell a manager so they can let ${at} know.` };
  }
}

/** One recorded issue's email status in words — the reopened delivery. */
export function issueEmailStatusText(r: {
  emailStatus: string; emailError: string | null; emailedToName: string | null;
}, supplierName: string): { ok: boolean; text: string } {
  const who = r.emailedToName ? `${r.emailedToName} at ${supplierName}` : supplierName;
  switch (r.emailStatus) {
    case "sent": return { ok: true, text: `Emailed ${who}.` };
    case "no_address": return { ok: false, text: `Email not sent — ${supplierName} has no account manager email set.` };
    case "skipped": return { ok: false, text: "Email not sent — this copy of the app doesn't send emails." };
    case "pending": return { ok: false, text: "Email still being sent (or the send was interrupted)." };
    default: return { ok: false, text: `Email failed${r.emailError ? `: ${r.emailError}` : ""}. Tell ${supplierName} directly.` };
  }
}
