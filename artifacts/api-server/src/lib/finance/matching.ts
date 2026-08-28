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
}

export interface MatchSuggestion {
  emailIndexId: number;
  score: number; // 0-100
  reasons: string[];
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

export function scoreLineAgainstEmail(line: LineForMatch, email: EmailForMatch): MatchSuggestion | null {
  const reasons: string[] = [];
  let points = 0;
  // Real evidence = the amount appears, or the sender/subject ties to the
  // merchant. Date proximity and a PDF attachment are only ever
  // tiebreakers — "an email with a PDF from around the right date"
  // described half the inbox and produced junk suggestions (Graeme,
  // 2026-08-28: Puffin Packaging offered against a Starlink charge).
  let hasEvidence = false;

  // Date window: emails from 30 days before to 5 days after the purchase.
  const offset = dayOffset(line, email);
  if (offset === null || offset < -30 || offset > 5) return null;
  if (offset >= -7 && offset <= 2) { points += 20; }
  else if (offset >= -21) { points += 12; }
  else { points += 6; }

  // Amount: settled GBP or the supplier-side original amount.
  const amountHit = email.amountsFound.some(
    (a) => amountsEqual(a, line.amount) || (line.originalAmount ? amountsEqual(a, line.originalAmount) : false)
  );
  if (amountHit) { points += 40; hasEvidence = true; reasons.push(`amount ${line.amount} appears in the email`); }

  // Merchant: known vendor domain beats name similarity.
  const merchantName = line.merchant ?? line.descriptor;
  if (email.fromDomain && line.vendorDomains.includes(email.fromDomain.toLowerCase())) {
    points += 30;
    hasEvidence = true;
    reasons.push(`sender ${email.fromDomain} is this supplier's known domain`);
  } else {
    const senderText = `${email.fromAddress ?? ""} ${email.subject ?? ""}`;
    const token = normaliseMerchant(merchantName).split(" ")[0];
    if (token && token.length >= 4 && senderText.toUpperCase().includes(token)) {
      points += 18;
      hasEvidence = true;
      reasons.push(`"${token}" appears in the sender/subject`);
    } else if (email.fromDomain && merchantsLooselyMatch(merchantName, email.fromDomain.split(".")[0])) {
      points += 18;
      hasEvidence = true;
      reasons.push(`sender domain resembles "${normaliseMerchant(merchantName)}"`);
    }
  }

  if (email.hasPdf) { points += 10; reasons.push("has a PDF attachment"); }

  if (!hasEvidence) return null;

  return { emailIndexId: email.id, score: Math.min(100, points), reasons };
}

/** Rank suggestions for one line; cap at the top 5 to keep review light. */
export function suggestMatches(line: LineForMatch, emails: EmailForMatch[]): MatchSuggestion[] {
  return emails
    .map((e) => scoreLineAgainstEmail(line, e))
    .filter((s): s is MatchSuggestion => s !== null && s.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
