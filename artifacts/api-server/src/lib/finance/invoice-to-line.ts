import { extractRefTokens, strengthOf, type MatchStrength } from "./matching";
import { merchantsLooselyMatch, normaliseMerchant } from "./merchant-normalise";

// Drop an invoice on Outstanding → "I think it's this one" (Graeme,
// 3 Nov 2026). The other direction from matching.ts: one invoice, read by
// Claude, scored against every transaction still waiting for one. Pure and
// unit-tested; a human always presses "Yes, attach".

export interface InvoiceForMatch {
  supplierName: string | null;
  invoiceDate: string | null; // ISO
  invoiceNumber: string | null;
  totalAmount: string | null;
}

export interface LineCandidate {
  id: number;
  lineDate: string; // ISO
  authDate: string | null;
  descriptor: string;
  merchant: string | null;
  vendorName: string | null;
  amount: string;
  originalAmount: string | null;
  orderReference: string | null;
}

export interface LineSuggestion {
  lineId: number;
  score: number; // 0-100
  signals: number; // of four: amount, supplier, date close, reference
  strength: MatchStrength;
  daysApart: number | null;
  reasons: string[];
  evidence: { amount: boolean; supplier: boolean; date: boolean; reference: boolean };
}

const DAY_MS = 86_400_000;

function amountsEqual(a: string, b: string): boolean {
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

/** Days from the invoice date to the card charge; negative = charged first. */
function daysApart(inv: InvoiceForMatch, line: LineCandidate): number | null {
  if (!inv.invoiceDate) return null;
  const charged = new Date(`${line.authDate ?? line.lineDate}T12:00:00Z`).getTime();
  const invoiced = new Date(`${inv.invoiceDate}T12:00:00Z`).getTime();
  if (Number.isNaN(charged) || Number.isNaN(invoiced)) return null;
  return Math.round((charged - invoiced) / DAY_MS);
}

/** The invoice's supplier against the names the line goes by: the vendor
 *  it's filed under, the card's merchant name and the raw descriptor. */
function supplierMatches(supplier: string, line: LineCandidate): boolean {
  const names = [line.vendorName, line.merchant, line.descriptor].filter((n): n is string => !!n);
  const firstWord = normaliseMerchant(supplier).split(" ")[0] ?? "";
  return names.some((n) => {
    if (merchantsLooselyMatch(supplier, n)) return true;
    if (firstWord.length < 4) return false;
    return normaliseMerchant(n).split(" ").includes(firstWord) || n.toUpperCase().includes(firstWord);
  });
}

export function scoreInvoiceAgainstLine(inv: InvoiceForMatch, line: LineCandidate): LineSuggestion | null {
  const reasons: string[] = [];
  let points = 0;

  const amountHit = !!inv.totalAmount && (
    amountsEqual(inv.totalAmount, line.amount) ||
    (line.originalAmount ? amountsEqual(inv.totalAmount, line.originalAmount) : false)
  );
  if (amountHit) { points += 45; reasons.push(`same amount, £${Number(line.amount).toFixed(2)}`); }

  const nameHit = !!inv.supplierName && supplierMatches(inv.supplierName, line);
  if (nameHit) { points += 30; reasons.push(`same supplier`); }

  // A supplier's invoice and its card charge can sit either side of each
  // other — paid at checkout and invoiced later, or billed monthly in
  // arrears — so the window is wide, and closeness only ranks.
  const days = daysApart(inv, line);
  if (days !== null && (days < -45 || days > 45)) return null;
  const dateClose = days !== null && Math.abs(days) <= 7;
  if (days !== null) {
    points += dateClose ? 15 : Math.abs(days) <= 31 ? 8 : 2;
    reasons.push(days === 0 ? "charged the same day" : `charged ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${days > 0 ? "after" : "before"} the invoice date`);
  }

  let refHit = false;
  const invoiceTokens = inv.invoiceNumber ? extractRefTokens(inv.invoiceNumber) : [];
  if (invoiceTokens.length > 0) {
    const lineTokens = new Set([
      ...extractRefTokens(line.descriptor),
      ...(line.orderReference ? extractRefTokens(line.orderReference) : []),
    ]);
    const hit = invoiceTokens.find((t) => lineTokens.has(t));
    if (hit) { points += 35; refHit = true; reasons.push(`reference ${hit} on both`); }
  }

  // Real evidence is the amount, the supplier or the reference; a date on
  // its own describes half the list.
  if (!amountHit && !nameHit && !refHit) return null;

  const signals = (amountHit ? 1 : 0) + (nameHit ? 1 : 0) + (dateClose ? 1 : 0) + (refHit ? 1 : 0);
  return {
    lineId: line.id, score: Math.min(100, points), signals, strength: strengthOf(signals), daysApart: days, reasons,
    evidence: { amount: amountHit, supplier: nameHit, date: dateClose, reference: refHit },
  };
}

/** Best first: most signals, then score, then the nearest date — which is
 *  what tells this month's invoice from last month's at the same price. */
export function rankLinesForInvoice(inv: InvoiceForMatch, lines: LineCandidate[], limit = 5): LineSuggestion[] {
  return lines
    .map((l) => scoreInvoiceAgainstLine(inv, l))
    .filter((s): s is LineSuggestion => s !== null && s.signals >= 1)
    .sort((a, b) =>
      b.signals - a.signals ||
      b.score - a.score ||
      Math.abs(a.daysApart ?? 999) - Math.abs(b.daysApart ?? 999))
    .slice(0, limit);
}

/** Confident enough to put forward as "I think it's this one": the amount
 *  and supplier both agree, and nothing else ranks level with it. */
export function isConfidentPick(ranked: LineSuggestion[]): boolean {
  const [top, next] = ranked;
  if (!top || top.signals < 2) return false;
  if (!next) return true;
  return top.signals > next.signals || top.score > next.score ||
    Math.abs(top.daysApart ?? 999) < Math.abs(next.daysApart ?? 999);
}

export interface QueuedInvoice extends InvoiceForMatch {
  id: number;
  docKind: string;
  readStatus: string;
  rejectedLineIds: number[];
}

export interface CertainMatch {
  invoiceId: number;
  lineId: number;
  reasons: string[];
}

export const withoutRejected = <L extends { id: number }>(lines: L[], rejected: number[]): L[] =>
  lines.filter((l) => !rejected.includes(l.id));

/**
 * Invoices that can be attached with nobody pressing anything (Graeme,
 * 4 Nov 2026: "obviously and undeniably accurate"). All of these must hold,
 * or it goes to a person to check:
 *  - a VAT invoice that was read automatically, not a receipt or a statement;
 *  - the same amount AND the same supplier, charged within a week of the
 *    invoice date or carrying its reference;
 *  - it's the only transaction with that supplier and amount in the whole
 *    six-week window, which rules out a monthly charge at the same price;
 *  - no other queued invoice wants the same transaction.
 */
export function pickCertainMatches(invoices: QueuedInvoice[], lines: LineCandidate[]): CertainMatch[] {
  const picks: CertainMatch[] = [];
  for (const inv of invoices) {
    if (inv.docKind !== "invoice" || inv.readStatus !== "done") continue;
    const sameCharge = withoutRejected(lines, inv.rejectedLineIds)
      .map((l) => scoreInvoiceAgainstLine(inv, l))
      .filter((s): s is LineSuggestion => !!s && s.evidence.amount && s.evidence.supplier);
    if (sameCharge.length !== 1) continue;
    const [only] = sameCharge;
    if (only.evidence.date || only.evidence.reference) picks.push({ invoiceId: inv.id, lineId: only.lineId, reasons: only.reasons });
  }
  const wanted = new Map<number, number>();
  for (const p of picks) wanted.set(p.lineId, (wanted.get(p.lineId) ?? 0) + 1);
  return picks.filter((p) => wanted.get(p.lineId) === 1);
}
