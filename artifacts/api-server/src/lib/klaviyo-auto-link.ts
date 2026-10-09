/**
 * Klaviyo auto-link: which planned email became which Klaviyo campaign
 * (Graeme, 2026-10-09: "I create a draft in the calendar, then Tommy goes
 * into Klaviyo and creates the Klaviyo email and it links them together by
 * matching the name, subject etc for a partial match"). Objective H.
 *
 * PURE and tested (klaviyo-auto-link.test.ts) — no database, no network.
 * The runner (klaviyo-auto-link-run.ts) feeds it and does the linking.
 *
 * The rules, in plain words:
 *  - Words, not characters. Both sides are lower-cased, accents, emoji and
 *    punctuation dropped, and noise ignored: little words ("the", "your"…),
 *    Klaviyo's "copy" / "draft" / "clone" / "v2", and dates (numbers and
 *    month names — day names stay, "Black Friday" is a subject). "BF" matches "Black Friday" (initials), "launch"
 *    matches "launching" (same start), "box" matches "boxes".
 *  - The plan's subject line is compared with the campaign's NAME and,
 *    separately, its SUBJECT LINE; the better of the two counts.
 *  - A word that appears in lots of Klaviyo campaigns ("VIP", "offer")
 *    counts for less than a word only one campaign uses.
 *  - At least two words must match (or the whole of both sides).
 *  - Date: a draft's day is only a placeholder (Klaviyo sets it to when the
 *    draft was made), so it barely counts. For scheduled or sent emails the
 *    day matters more, and more than 21 days apart never links.
 *  - Linking needs a score of AUTO_LINK_MIN or more AND to be the clear best
 *    both ways — the plan's best campaign and the campaign's best plan, each
 *    ahead of the runner-up by MARGIN. Anything else that scores
 *    SUGGEST_MIN or more is offered as a one-tap suggestion instead.
 *  - Never touches a plan that is linked or deleted, a campaign already
 *    linked to a plan, or a pair someone deliberately unlinked.
 */

export const AUTO_LINK_MIN = 0.6;
export const SUGGEST_MIN = 0.4;
export const MARGIN = 0.15;
export const MAX_DAYS_APART_SENT = 21;

export interface PlanForMatch {
  id: number;
  subject: string;
  sendDate: string;
  klaviyoCampaignId: string | null;
  deleted?: boolean;
}

export interface CampaignForMatch {
  id: string;
  name: string;
  subject: string | null;
  status: "Draft" | "Scheduled" | "Sending" | "Sent";
  /** London day it sends / sent — for a draft, its placeholder day. */
  date: string;
}

export interface MatchInput {
  plans: PlanForMatch[];
  campaigns: CampaignForMatch[];
  /** Campaign ids already linked to a (live) plan. */
  linkedCampaignIds?: Iterable<string>;
  /** Pairs someone unlinked on purpose — never re-linked or suggested. */
  unlinkedPairs?: Iterable<{ emailId: number; campaignId: string }>;
}

export interface PairMatch {
  emailId: number;
  planSubject: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: CampaignForMatch["status"];
  /** 0–1. */
  score: number;
  /** Which Klaviyo field matched best, and its text. */
  field: "name" | "subject";
  fieldText: string;
  /** The plan's words that were found, as normalised. */
  matchedWords: string[];
  daysApart: number;
}

export interface MatchResult {
  links: PairMatch[];
  suggestions: PairMatch[];
}

// ── Normalising ────────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "at", "by", "with", "from", "is", "it", "its", "this",
  "that", "be", "are", "was", "we", "us", "our", "ours", "you", "your", "yours", "my", "me", "i", "so", "all", "just",
  "now", "up", "out", "as", "but", "if", "into", "here", "there", "has", "have", "do", "does", "can", "will", "re",
]);
// Klaviyo's own noise in campaign names.
const NOISE_WORDS = new Set(["copy", "draft", "clone", "cloned", "email", "campaign", "final", "new"]);
const DATE_WORDS = new Set([
  "jan", "january", "feb", "february", "mar", "march", "apr", "april", "may", "jun", "june", "jul", "july", "aug",
  "august", "sep", "sept", "september", "oct", "october", "nov", "november", "dec", "december",
  "today", "tomorrow", "tonight",
]);
// Day names are kept: "Black Friday", "Cyber Monday" and "Sunday roast" are
// what an email is about, not when it sends.

function stem(t: string): string {
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.endsWith("es") && t.length > 4 && /(x|ch|sh)es$/.test(t) ? t.slice(0, -2) : t.slice(0, -1);
  return t;
}

/** Meaningful words of a piece of text, in order. */
export function matchWords(text: string | null | undefined): string[] {
  if (!text) return [];
  const plain = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ");
  const out: string[] = [];
  for (const raw of plain.split(" ")) {
    if (raw.length < 2) continue;
    if (STOP_WORDS.has(raw) || NOISE_WORDS.has(raw) || DATE_WORDS.has(raw)) continue;
    if (/^\d+(st|nd|rd|th)?$/.test(raw) || /^v\d+$/.test(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.startsWith(s);
}

/** Which words on each side found a partner (exact / same start, then initials). */
export function pairWords(A: string[], B: string[]): { mA: boolean[]; mB: boolean[] } {
  const mA = A.map(() => false);
  const mB = B.map(() => false);
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < B.length; j++) {
      if (!mB[j] && sameWord(A[i], B[j])) { mA[i] = true; mB[j] = true; break; }
    }
  }
  const initials = (X: string[], mX: boolean[], Y: string[], mY: boolean[]) => {
    for (let i = 0; i < X.length; i++) {
      const t = X[i];
      if (mX[i] || t.length < 2 || t.length > 4 || /\d/.test(t)) continue;
      for (let j = 0; j + t.length <= Y.length; j++) {
        let ok = true;
        for (let k = 0; k < t.length && ok; k++) ok = !mY[j + k] && Y[j + k][0] === t[k];
        if (ok) {
          mX[i] = true;
          for (let k = 0; k < t.length; k++) mY[j + k] = true;
          break;
        }
      }
    }
  };
  initials(A, mA, B, mB);
  initials(B, mB, A, mA);
  return { mA, mB };
}

/** Text likeness, 0–1, of a plan's words against one Klaviyo field. */
export function textScore(A: string[], B: string[], weight: (w: string) => number = () => 1): { score: number; matched: string[] } {
  if (A.length === 0 || B.length === 0) return { score: 0, matched: [] };
  const { mA, mB } = pairWords(A, B);
  const nA = mA.filter(Boolean).length;
  const nB = mB.filter(Boolean).length;
  const whole = nA === A.length && nB === B.length;
  if (nA < 2 && !whole) return { score: 0, matched: [] };
  const sum = (X: string[], m?: boolean[]) => X.reduce((s, w, i) => s + (m && !m[i] ? 0 : weight(w)), 0);
  const wA = sum(A), wB = sum(B), wmA = sum(A, mA), wmB = sum(B, mB);
  const contain = Math.max(wmA / wA, wmB / wB);
  const sim = (wmA + wmB) / (wA + wB);
  return { score: 0.5 * contain + 0.5 * sim, matched: A.filter((_, i) => mA[i]) };
}

function daysApart(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
}

/** How much the day counts: drafts barely (placeholder day), real sends more.
 *  null = too far apart to ever be the same email. */
export function dateFactor(status: CampaignForMatch["status"], days: number): number | null {
  if (status === "Draft") return 1 - 0.15 * Math.min(days, 60) / 60;
  if (days > MAX_DAYS_APART_SENT) return null;
  return 1 - 0.35 * days / MAX_DAYS_APART_SENT;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Every plausible plan ↔ campaign pairing, scored. */
export function scorePairs(input: MatchInput): PairMatch[] {
  const linked = new Set(input.linkedCampaignIds ?? []);
  const rejected = new Set([...(input.unlinkedPairs ?? [])].map(p => `${p.emailId}|${p.campaignId}`));
  const plans = input.plans.filter(p => !p.deleted && !p.klaviyoCampaignId);
  const campaigns = input.campaigns.filter(c => !linked.has(c.id));

  // Words used by many campaigns count for less.
  const campWords = new Map(campaigns.map(c => [c.id, { name: matchWords(c.name), subject: matchWords(c.subject) }]));
  const df = new Map<string, number>();
  for (const w of campWords.values()) for (const t of new Set([...w.name, ...w.subject])) df.set(t, (df.get(t) ?? 0) + 1);
  const weight = (t: string) => 1 / Math.sqrt(Math.max(1, df.get(t) ?? 1));

  const out: PairMatch[] = [];
  for (const p of plans) {
    const A = matchWords(p.subject);
    if (A.length === 0) continue;
    for (const c of campaigns) {
      if (rejected.has(`${p.id}|${c.id}`)) continue;
      const days = daysApart(p.sendDate, c.date);
      const f = dateFactor(c.status, days);
      if (f == null) continue;
      const w = campWords.get(c.id)!;
      const byName = textScore(A, w.name, weight);
      const bySubject = textScore(A, w.subject, weight);
      const best = bySubject.score > byName.score ? { ...bySubject, field: "subject" as const, text: c.subject ?? "" } : { ...byName, field: "name" as const, text: c.name };
      if (best.score <= 0) continue;
      out.push({
        emailId: p.id, planSubject: p.subject, campaignId: c.id, campaignName: c.name, campaignStatus: c.status,
        score: round(best.score * f), field: best.field, fieldText: best.text, matchedWords: best.matched, daysApart: days,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.emailId - b.emailId || a.campaignId.localeCompare(b.campaignId));
}

/** Confident links (clear best both ways) and one-tap suggestions for the rest. */
export function matchKlaviyoToPlans(input: MatchInput): MatchResult {
  const pairs = scorePairs(input);
  const byPlan = new Map<number, PairMatch[]>();
  const byCampaign = new Map<string, PairMatch[]>();
  for (const p of pairs) {
    (byPlan.get(p.emailId) ?? byPlan.set(p.emailId, []).get(p.emailId)!).push(p);
    (byCampaign.get(p.campaignId) ?? byCampaign.set(p.campaignId, []).get(p.campaignId)!).push(p);
  }
  const links: PairMatch[] = [];
  for (const list of byPlan.values()) {
    const best = list[0];
    if (best.score < AUTO_LINK_MIN) continue;
    const planRunnerUp = list[1]?.score ?? 0;
    const others = byCampaign.get(best.campaignId)!;
    if (others[0] !== best) continue; // the campaign prefers another plan
    const campaignRunnerUp = others[1]?.score ?? 0;
    if (best.score - planRunnerUp < MARGIN || best.score - campaignRunnerUp < MARGIN) continue;
    links.push(best);
  }
  const linkedPlans = new Set(links.map(l => l.emailId));
  const linkedCampaigns = new Set(links.map(l => l.campaignId));
  const suggestions: PairMatch[] = [];
  for (const [emailId, list] of byPlan) {
    if (linkedPlans.has(emailId)) continue;
    suggestions.push(...list.filter(p => p.score >= SUGGEST_MIN && !linkedCampaigns.has(p.campaignId)).slice(0, 3));
  }
  return { links, suggestions };
}

/** The history line for an automatic link. */
export function describeAutoLink(m: Pick<PairMatch, "campaignName" | "planSubject" | "field" | "fieldText">): string {
  const where = m.field === "name" || m.fieldText === m.campaignName ? "its name" : `its subject line “${m.fieldText}”`;
  return `linked automatically to the Klaviyo email “${m.campaignName}” (matched “${m.planSubject}” to ${where})`;
}

/** How a planned email's CURRENT link was made, from its history (newest
 *  first): the latest line pointing at that campaign. Automatic → what
 *  matched; made by a person (or not found) → null. */
export function autoLinkInfo(
  current: string | null,
  history: Array<{ changes: unknown; createdAt: Date }>,
): { matched: string; at: string } | null {
  if (!current) return null;
  for (const h of history) {
    const c = h.changes as { klaviyoCampaignId?: { to?: string | null }; auto?: { matched?: string } } | null;
    if (!c?.klaviyoCampaignId || c.klaviyoCampaignId.to !== current) continue;
    return c.auto?.matched ? { matched: c.auto.matched, at: h.createdAt.toISOString() } : null;
  }
  return null;
}

/** Pairs someone took apart, from history rows' `changes` — any change that
 *  moved a plan OFF a campaign (unlink, or switching to another one). */
export function unlinkedPairsFrom(rows: Array<{ emailId: number; changes: unknown }>): Array<{ emailId: number; campaignId: string }> {
  const out: Array<{ emailId: number; campaignId: string }> = [];
  for (const r of rows) {
    const k = (r.changes as { klaviyoCampaignId?: { from?: string | null; to?: string | null } } | null)?.klaviyoCampaignId;
    if (k?.from && k.from !== k.to) out.push({ emailId: r.emailId, campaignId: k.from });
  }
  return out;
}
