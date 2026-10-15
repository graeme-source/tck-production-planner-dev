/**
 * Goods-in: what each purchase-order line's receipt MEANS — the one set of
 * rules the receive dialog, the deliveries page and the server all use
 * (Graeme, 2026-10-15). Pure; no database, no React.
 *
 * The defect this replaces: the receive dialog pre-filled every line with the
 * ordered quantity and sent it whether the line was ticked or not, and the
 * server booked that quantity in (stock added, Shopify pushed). Three items
 * missing from a Brakes delivery were never ticked, yet showed a green
 * "received" tick on the deliveries page and went into stock.
 *
 * The rules now:
 *   - A line is RECEIVED only when it was ticked at goods-in. An un-ticked
 *     line counts as received 0, whatever quantity came with it
 *     (effectiveReceived — enforced on the server, so an old cached screen
 *     can't book ghost stock).
 *   - At goods-in every line must be decided: Received (at the quantity
 *     shown, which can be edited — a short delivery is "received" at a
 *     smaller number) or Not received. Nothing can be completed while a
 *     line is undecided (undecidedLines / canCompleteGoodsIn).
 *   - The deliveries page shows the truth per line (lineStatus) and per
 *     order (orderShortage).
 *   - Short or missing lines become a short-delivery report on the
 *     Production Flow Manager team list and for chosen people
 *     (shortLinesOf, shortReportText, reportAction, reportRecipients).
 *
 * Objectives C (stock stays right) and D (goods-in checks every time).
 */
import { formatCount, packNoun, unitWord } from "@workspace/units";

// ── The server rule ────────────────────────────────────────────────────────

/** What a submitted line really received: its quantity when it was ticked
 *  as received, otherwise 0. Negative or non-numbers count as 0. */
export function effectiveReceived(checked: boolean | null | undefined, quantity: number): number {
  if (checked !== true) return 0;
  const q = Number(quantity);
  return Number.isFinite(q) && q > 0 ? q : 0;
}

// ── What the deliveries page shows per line ────────────────────────────────

/**
 *   pending       the order hasn't been received yet
 *   received      ticked, and at least what was ordered arrived (green tick)
 *   short         ticked, but less than ordered arrived (amber)
 *   not_received  nothing arrived (red)
 *   unconfirmed   stock was booked in but the line was never ticked — only
 *                 seen on receipts made before 15 Oct 2026, when an
 *                 un-ticked line could still be booked in. Amber: someone
 *                 should check it really arrived.
 */
export type LineStatus = "pending" | "received" | "short" | "not_received" | "unconfirmed";

export interface LineFacts {
  quantityOrdered: number;
  quantityReceived: number;
  /** Ticked as received at goods-in. */
  goodsInChecked: boolean | null | undefined;
}

export function isReceivedOrderStatus(status: string | null | undefined): boolean {
  return status === "received" || status === "partially_received";
}

export function lineStatus(orderReceived: boolean, line: LineFacts): LineStatus {
  if (!orderReceived) return "pending";
  const received = Number(line.quantityReceived) || 0;
  const ordered = Number(line.quantityOrdered) || 0;
  if (received <= 0) return "not_received";
  if (line.goodsInChecked !== true) return "unconfirmed";
  if (received < ordered) return "short";
  return "received";
}

export interface OrderShortage {
  /** Lines that arrived but fewer than ordered. */
  short: number;
  /** Lines where nothing arrived. */
  notReceived: number;
  /** Lines booked in without a tick (old receipts) — need checking. */
  unconfirmed: number;
  /** short + notReceived: the "2 items short" count. */
  itemsShort: number;
  /** "2 items short", "1 item short", or null when nothing is. */
  label: string | null;
}

export function orderShortage(orderReceived: boolean, lines: LineFacts[]): OrderShortage {
  let short = 0, notReceived = 0, unconfirmed = 0;
  if (orderReceived) {
    for (const l of lines) {
      const s = lineStatus(true, l);
      if (s === "short") short++;
      else if (s === "not_received") notReceived++;
      else if (s === "unconfirmed") unconfirmed++;
    }
  }
  const itemsShort = short + notReceived;
  return {
    short, notReceived, unconfirmed, itemsShort,
    label: itemsShort === 0 ? null : `${itemsShort} ${itemsShort === 1 ? "item" : "items"} short`,
  };
}

// ── The receive dialog ─────────────────────────────────────────────────────

/** Received (at the quantity shown) / Not received / not decided yet. */
export type LineDecision = "received" | "not_received" | null;

/** The decision a line opens with. Before goods-in: undecided (someone has
 *  to look at it). Re-opening a received order: what was recorded — except a
 *  line booked in without a tick (old receipts), which must be decided now. */
export function initialDecision(orderReceived: boolean, line: LineFacts): LineDecision {
  if (!orderReceived) return line.goodsInChecked === true ? "received" : null;
  const received = Number(line.quantityReceived) || 0;
  if (received <= 0) return "not_received";
  return line.goodsInChecked === true ? "received" : null;
}

/** The quantity box opens at what was recorded, or what was ordered when
 *  nothing has been recorded yet (so "Received" on a full delivery is one
 *  tap). The box is only SENT for a line decided "received". */
export function initialQuantity(line: LineFacts): number {
  const received = Number(line.quantityReceived) || 0;
  return received > 0 ? received : Number(line.quantityOrdered) || 0;
}

export interface DialogLine {
  decision: LineDecision;
  /** The quantity in the box. */
  quantity: number;
}

/** What goes to the server for a line: ticked + its quantity when received,
 *  un-ticked + 0 otherwise. Received at 0 is the same as not received. */
export function lineToSubmit(line: DialogLine): { checked: boolean; quantityReceived: number } {
  const qty = Number(line.quantity) || 0;
  if (line.decision === "received" && qty > 0) return { checked: true, quantityReceived: qty };
  return { checked: false, quantityReceived: 0 };
}

/** Indexes of the lines nobody has decided yet. */
export function undecidedLines<T extends { decision: LineDecision }>(lines: T[]): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => { if (l.decision == null) out.push(i); });
  return out;
}

/** Goods-in can't be completed while any line is undecided. */
export function canCompleteGoodsIn<T extends { decision: LineDecision }>(lines: T[]): boolean {
  return undecidedLines(lines).length === 0;
}

// ── The short-delivery report ──────────────────────────────────────────────

export interface ReportLineInput {
  lineId: number;
  name: string;
  quantityOrdered: number;
  /** Effective received (after the un-ticked → 0 rule). */
  quantityReceived: number;
  /** The PO line's unit ("kg", "packs", "Bottles", "each" …). */
  unit: string;
  /** The ingredient's own unit, when the line is a pack count. */
  nativeUnit?: string | null;
  packWeight?: number | string | null;
  stockInPacks?: boolean | null;
}

export interface ShortLine extends ReportLineInput {
  missing: boolean;
}

/** Lines where less arrived than was ordered — missing ones first, then the
 *  rest in order. Lines with nothing ordered (added at the door) never count. */
export function shortLinesOf(lines: ReportLineInput[]): ShortLine[] {
  const out: ShortLine[] = [];
  for (const l of lines) {
    const ordered = Number(l.quantityOrdered) || 0;
    const received = Math.max(0, Number(l.quantityReceived) || 0);
    if (ordered <= 0 || received >= ordered) continue;
    out.push({ ...l, quantityReceived: received, missing: received === 0 });
  }
  return [...out.filter(l => l.missing), ...out.filter(l => !l.missing)];
}

/** One string per state of the short lines: two submissions with the same
 *  shortfall give the same signature, so a re-save sends nothing new. */
export function shortSignature(lines: ShortLine[]): string {
  return [...lines]
    .sort((a, b) => a.lineId - b.lineId)
    .map(l => `${l.lineId}:${Number(l.quantityOrdered)}:${Number(l.quantityReceived)}`)
    .join("|");
}

const PACK_COUNT_UNITS = new Set(["packs", "bottles", "pallets"]);

/** A line quantity as people say it: "8 bottles", "15 kg", "6 packs",
 *  "1,800 each". Pack-counted ingredients read in packs. */
export function formatReportQty(qty: number, line: Pick<ReportLineInput, "unit" | "nativeUnit" | "packWeight" | "stockInPacks">): string {
  if (qty === 0) return "0";
  const pw = Number(line.packWeight);
  const hasPack = Number.isFinite(pw) && pw > 0;
  const native = line.nativeUnit ?? line.unit;
  if (PACK_COUNT_UNITS.has(line.unit) && hasPack) return `${formatCount(qty)} ${packNoun(native, qty)}`;
  if (line.stockInPacks && hasPack && !PACK_COUNT_UNITS.has(line.unit)) {
    const packs = Math.round((qty / pw) * 100) / 100;
    return `${formatCount(packs)} ${packNoun(native, packs)}`;
  }
  return `${formatCount(qty)} ${unitWord(line.unit, qty)}`.trim();
}

/** "Whole milk — ordered 8 bottles, received 0". */
export function reportLineText(l: ShortLine): string {
  return `${l.name} — ordered ${formatReportQty(Number(l.quantityOrdered), l)}, received ${formatReportQty(Number(l.quantityReceived), l)}`;
}

export interface ReportContext {
  supplierName: string;
  purchaseOrderId: number;
  receivedByName: string | null;
  /** "07:02" London time. */
  receivedTime: string;
  /** "Thu 15 Oct". */
  receivedDay: string;
  note?: string | null;
  /** A follow-up after the quantities were edited. */
  update?: boolean;
}

/** The team-list item / to-do text: a short report anyone can act on. */
export function shortReportText(lines: ShortLine[], ctx: ReportContext): { title: string; notes: string } {
  const n = lines.length;
  const who = ctx.receivedByName ? ` by ${ctx.receivedByName}` : "";
  if (n === 0) {
    return {
      title: `Update — ${ctx.supplierName} delivery (PO #${ctx.purchaseOrderId}) now all received`,
      notes: `Quantities edited${who} at ${ctx.receivedTime} on ${ctx.receivedDay}: everything ordered is now recorded as received.`,
    };
  }
  const missing = lines.filter(l => l.missing).length;
  const what = missing === n
    ? `${n} ${n === 1 ? "item" : "items"} not delivered`
    : `${n} ${n === 1 ? "item" : "items"} short`;
  const title = `${ctx.update ? "Update — " : ""}Short delivery: ${ctx.supplierName} (PO #${ctx.purchaseOrderId}) — ${what}`;
  const parts = [
    `${ctx.update ? "Quantities edited" : "Received"}${who} at ${ctx.receivedTime} on ${ctx.receivedDay}. Ordered but not delivered in full:`,
    lines.map(l => `• ${reportLineText(l)}`).join("\n"),
  ];
  const note = ctx.note?.trim();
  if (note) parts.push(`Note: ${note}`);
  parts.push("Check whether anything needs buying or chasing today.");
  return { title, notes: parts.join("\n\n") };
}

/**
 *   none      nothing short and nothing reported before
 *   create    first report for this delivery
 *   same      already reported exactly this — only newly chosen people hear
 *   changed   the shortfall changed since the last report (an edit):
 *             a follow-up; resolved = nothing is short any more
 */
export type ReportAction =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "same" }
  | { kind: "changed"; resolved: boolean };

export function reportAction(previousSignature: string | null, lines: ShortLine[]): ReportAction {
  const sig = shortSignature(lines);
  if (previousSignature == null) return lines.length ? { kind: "create" } : { kind: "none" };
  if (sig === previousSignature) return { kind: "same" };
  return { kind: "changed", resolved: lines.length === 0 };
}

/**
 * Who gets a to-do for a report.
 *   configured  the people the settings say always get these
 *   chosen      the "Also tell…" picker at goods-in (it opens pre-filled
 *               with the configured people; removing one counts). Undefined
 *               when nobody was asked (an older screen): the configured
 *               people plus whoever was told last time.
 *   previous    people told about this delivery before
 *   senderId    the person completing goods-in — gets the to-do if listed,
 *               but never a bell for their own report
 * `toTell` = everyone who should get THIS to-do; `bells` = toTell minus the
 * sender. No duplicates, order kept.
 */
export function reportRecipients(args: {
  configured: number[];
  chosen?: number[] | null;
  previous?: number[] | null;
  senderId: number | null | undefined;
}): { all: number[]; bells: number[] } {
  const base = args.chosen ?? [...args.configured, ...(args.previous ?? [])];
  const all = [...new Set(base.filter(id => Number.isInteger(id) && id > 0))];
  return { all, bells: all.filter(id => id !== args.senderId) };
}

/** Of `all`, the people not told before — for a "same" report, so adding a
 *  name at an edit tells them without re-telling everyone else. */
export function newlyAdded(all: number[], previous: number[] | null | undefined): number[] {
  const told = new Set(previous ?? []);
  return all.filter(id => !told.has(id));
}
