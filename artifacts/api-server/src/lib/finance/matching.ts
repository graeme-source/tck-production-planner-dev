import { merchantsLooselyMatch, normaliseMerchant } from "./merchant-normalise";

// MVP matching heuristic: line ↔ indexed mailbox message. Deterministic,
// pure, unit-tested. Suggestions only — a human confirms every match (the
// plan's shadow-mode rule: no auto-attach until thresholds are calibrated
// on real decisions).

export interface LineForMatch {
  id: number;
  merchant: string | null;
  descriptor: string;
  amount: string; // GBP settled
  originalAmount: string | null; // e.g. USD price the supplier would quote
  authDate: string | null; // ISO
  lineDate: string; // ISO
  vendorDomains: string[]; // known sending domains for this vendor
}

export interface EmailForMatch {
  id: number;
  fromDomain: string | null;
  fromAddress: string | null;
  subject: string | null;
  internalDate: Date | null;
  hasPdf: boolean;
  amountsFound: string[];
  orderIdsFound: string[];
}

export type MatchStrength = "weak" | "medium" | "strong" | "very_strong";

export interface MatchSuggestion {
  emailIndexId: number;
  score: number; // 0-100
  /** How many of the four signals matched: amount, date-in-window,
   *  company name, reference id (Graeme's tiers, 2026-08-28). */
  signals: number;
  strength: MatchStrength;
  reasons: string[];
}

export function strengthOf(signals: number): MatchStrength {
  return signals >= 4 ? "very_strong" : signals === 3 ? "strong" : signals === 2 ? "medium" : "weak";
}

const DAY_MS = 86_400_000;

/** Days from line's best purchase date to the email; negative = email earlier. */
function dayOffset(line: LineForMatch, email: EmailForMatch): number | null {
  if (!email.internalDate) return null;
  const anchor = new Date(`${line.authDate ?? line.lineDate}T12:00:00Z`).getTime();
  return Math.round((email.internalDate.getTime() - anchor) / DAY_MS);
}

function amountsEqual(a: string, b: string): boolean {
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

/**
 * Reference-like tokens (order ids, transaction ids) from free text:
 * alphanumeric runs of 6+ containing at least one digit — "IEI26-02348456",
 * "ADS9562308399", "F57441505", Amazon's 3-7-7. Card-ending fragments and
 * bare phone-ish number runs are excluded.
 */
export function extractRefTokens(text: string, cap = 20): string[] {
  const out = new Set<string>();
  const re = /\b[A-Z0-9][A-Z0-9-]{5,}\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && out.size < cap) {
    const tok = m[0].toUpperCase();
    if (!/\d/.test(tok)) continue;               // must contain a digit
    if (/^\+?\d{10,}$/.test(tok)) continue;      // phone-number runs
    if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) continue; // dates
    if (/^ENDING/.test(tok)) continue;
    out.add(tok);
  }
  return [...out];
}

export function scoreLineAgainstEmail(line: LineForMatch, email: EmailForMatch): MatchSuggestion | null {
  const reasons: string[] = [];
  let points = 0;
  // Real evidence = the amount appears, or the sender/subject ties to the
  // merchant. Date proximity and a PDF attachment are only ever
  // tiebreakers — "an email with a PDF from around the right date"
  // described half the inbox and produced junk suggestions (Graeme,
  // 2026-08-28: Puffin Packaging offered against a Starlink charge).
  let hasEvidence = false;

  // Date gate (Graeme, 2026-08-28): the working window is a week either
  // side of the purchase — his instinct is the invoice follows the
  // transaction, and the -7 covers authorisation-vs-clearance drift.
  // Older/further emails are only considered when the amount matches
  // exactly (monthly-arrears billers, slow invoicers).
  const offset = dayOffset(line, email);
  if (offset === null || offset < -30 || offset > 14) return null;
  const inBaseWindow = offset >= -7 && offset <= 7;
  if (offset >= -3 && offset <= 7) { points += 20; }
  else if (inBaseWindow) { points += 14; }
  else { points += 6; }

  // Amount: settled GBP or the supplier-side original amount.
  const amountHit = email.amountsFound.some(
    (a) => amountsEqual(a, line.amount) || (line.originalAmount ? amountsEqual(a, line.originalAmount) : false)
  );
  if (amountHit) { points += 40; hasEvidence = true; reasons.push(`amount ${line.amount} appears in the email`); }
  if (!inBaseWindow && !amountHit) return null;

  // Reference / order id: a token from the card descriptor appearing in
  // the email's subject or extracted ids is near-certain identification.
  const lineTokens = extractRefTokens(line.descriptor);
  let refHit = false;
  if (lineTokens.length > 0) {
    const emailTokens = new Set([
      ...extractRefTokens(email.subject ?? ""),
      ...email.orderIdsFound.map((t) => t.toUpperCase()),
    ]);
    const hit = lineTokens.find((t) => emailTokens.has(t));
    if (hit) { points += 35; refHit = true; hasEvidence = true; reasons.push(`reference ${hit} appears in both`); }
  }

  // Merchant: known vendor domain beats name similarity.
  const merchantName = line.merchant ?? line.descriptor;
  let nameHit = false;
  if (email.fromDomain && line.vendorDomains.includes(email.fromDomain.toLowerCase())) {
    points += 30;
    nameHit = true;
    reasons.push(`sender ${email.fromDomain} is this supplier's known domain`);
  } else {
    const senderText = `${email.fromAddress ?? ""} ${email.subject ?? ""}`;
    const token = normaliseMerchant(merchantName).split(" ")[0];
    if (token && token.length >= 4 && senderText.toUpperCase().includes(token)) {
      points += 18;
      nameHit = true;
      reasons.push(`"${token}" appears in the sender/subject`);
    } else if (email.fromDomain && merchantsLooselyMatch(merchantName, email.fromDomain.split(".")[0])) {
      points += 18;
      nameHit = true;
      reasons.push(`sender domain resembles "${normaliseMerchant(merchantName)}"`);
    }
  }
  if (nameHit) hasEvidence = true;

  if (email.hasPdf) { points += 10; reasons.push("has a PDF attachment"); }

  if (!hasEvidence) return null;

  // Tier by signal count. Date-in-window counts as a signal, but never
  // qualifies alone (hasEvidence above needs amount/name/reference).
  const signals =
    (amountHit ? 1 : 0) +
    (inBaseWindow ? 1 : 0) +
    (nameHit ? 1 : 0) +
    (refHit ? 1 : 0);

  return { emailIndexId: email.id, score: Math.min(100, points), signals, strength: strengthOf(signals), reasons };
}

/** Rank suggestions for one line; cap at the top 5 to keep review light. */
export function suggestMatches(line: LineForMatch, emails: EmailForMatch[]): MatchSuggestion[] {
  return emails
    .map((e) => scoreLineAgainstEmail(line, e))
    .filter((s): s is MatchSuggestion => s !== null && s.score >= 30)
    .sort((a, b) => b.signals - a.signals || b.score - a.score)
    .slice(0, 5);
}
