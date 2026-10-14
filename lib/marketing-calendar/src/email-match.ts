/**
 * Marrying planned emails and Klaviyo campaigns (Graeme, 2026-10-14: "we're
 * putting draft emails into the calendar, and then we're building them in
 * Klaviyo, and then it's bringing another one in. We really need to marry
 * those up"). Objective I. PURE and tested (email-match.test.ts).
 *
 * A TARGET is something we planned on a day: a stored planned email, or a
 * cycle slot nobody has touched yet. Each has the campaign name the list
 * suggests ("12 Oct – O1 Free Pack £39.95 – 1 Launch") — the name the team
 * pastes into Klaviyo.
 *
 * THE RULES, in order:
 *  1. EXACT NAME. The Klaviyo campaign's name is the suggested name
 *     (normaliseCampaignName: case, dash style, spacing, "(clone)" ignored).
 *     The day doesn't matter — the name carries it. Two campaigns with one
 *     name (a clone): the furthest along wins (sent > scheduled > draft).
 *  2. SAME DAY + SIMILAR NAME. The campaign sends on the target's day and
 *     its words (name and subject line) look like the target's (suggested
 *     name and subject): similarity SIMILAR_MIN or more, and clearly the best
 *     target that day. When the day has exactly one target and one campaign
 *     left, ONLY_ONE_MIN is enough — except for a "strict" target (a cycle
 *     slot nobody has touched), which always needs SIMILAR_MIN.
 *  3. Otherwise nothing — the page shows it as an "Unplanned Klaviyo email".
 * Never touches a campaign already linked, a target already linked, or a
 * pair someone unlinked on purpose.
 */
import { normaliseCampaignName, plannedCampaignName } from "./email-cycle";

export const SIMILAR_MIN = 0.5;
export const ONLY_ONE_MIN = 0.25;
/** How far ahead of the runner-up the best target must be. */
export const SIMILAR_MARGIN = 0.1;

export interface MatchTarget {
  /** Stable key: "plan:<id>" or "slot:<date>". */
  key: string;
  date: string;
  expectedName: string;
  subject: string;
  /** Never matched on the lower only-one-that-day bar — for cycle slots
   *  nobody has touched, which are ideas rather than emails someone wrote. */
  strict?: boolean;
}

export interface MatchCampaign {
  id: string;
  name: string;
  subject: string | null;
  status: string;
  /** London day it sends / sent (a draft: the day it is set for). */
  date: string;
}

export interface CampaignMatch {
  campaignId: string;
  campaignName: string;
  targetKey: string;
  how: "exact" | "similar";
  score: number;
}

const STATUS_RANK: Record<string, number> = { Sent: 3, Sending: 2, Scheduled: 2, Draft: 1 };

const STOP = new Set([
  "a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "at", "by", "with", "from", "is", "it", "its", "this",
  "that", "be", "are", "we", "us", "our", "you", "your", "me", "my", "so", "all", "just", "now", "up", "out", "as",
  "email", "campaign", "copy", "clone", "draft", "new",
]);
const MONTHS = new Set([
  "jan", "january", "feb", "february", "mar", "march", "apr", "april", "may", "jun", "june", "jul", "july", "aug",
  "august", "sep", "sept", "september", "oct", "october", "nov", "november", "dec", "december",
]);

/** The words that say what an email is about (prices kept whole: "39.95"). */
export function nameWords(text: string | null | undefined): string[] {
  if (!text) return [];
  const plain = text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/['’]/g, "");
  const out: string[] = [];
  for (const raw of plain.match(/[\p{L}\p{N}]+(?:[.,]\d+)*/gu) ?? []) {
    if (STOP.has(raw) || MONTHS.has(raw)) continue;
    if (/^\d{1,2}(st|nd|rd|th)?$/.test(raw)) continue; // day numbers, "1 Launch"
    let t = raw;
    if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") && !/\d/.test(t)) t = t.slice(0, -1);
    out.push(t);
  }
  return out;
}

function same(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.startsWith(s);
}

/** Dice similarity of two word lists (0–1), words matched one-to-one. */
export function wordSimilarity(a: readonly string[], b: readonly string[]): number {
  const A = [...new Set(a)];
  const B = [...new Set(b)];
  if (!A.length || !B.length) return 0;
  const used = new Set<number>();
  let common = 0;
  for (const w of A) {
    const j = B.findIndex((x, i) => !used.has(i) && same(w, x));
    if (j >= 0) { used.add(j); common++; }
  }
  return (2 * common) / (A.length + B.length);
}

/** How alike a campaign and a target are: the best of name↔name,
 *  subject↔subject and the crossings. */
export function campaignTargetScore(c: Pick<MatchCampaign, "name" | "subject">, t: Pick<MatchTarget, "expectedName" | "subject">): number {
  const cn = nameWords(c.name), cs = nameWords(c.subject);
  const tn = nameWords(t.expectedName), ts = nameWords(t.subject);
  return Math.max(wordSimilarity(cn, tn), wordSimilarity(cn, ts), wordSimilarity(cs, ts), wordSimilarity(cs, tn));
}

export function matchCampaignsToTargets(input: {
  targets: readonly MatchTarget[];
  campaigns: readonly MatchCampaign[];
  /** Campaigns already linked to a plan. */
  linkedCampaignIds?: Iterable<string>;
  /** Pairs someone took apart on purpose (targetKey + campaignId). */
  rejected?: Iterable<{ targetKey: string; campaignId: string }>;
}): { matches: CampaignMatch[]; unmatchedCampaignIds: string[] } {
  const linked = new Set(input.linkedCampaignIds ?? []);
  const rejected = new Set([...(input.rejected ?? [])].map(r => `${r.targetKey}|${r.campaignId}`));
  const open = input.campaigns.filter(c => !linked.has(c.id));
  const takenTargets = new Set<string>();
  const takenCampaigns = new Set<string>();
  const matches: CampaignMatch[] = [];
  const ok = (t: MatchTarget, c: MatchCampaign) => !rejected.has(`${t.key}|${c.id}`);

  // 1. Exact name.
  const byName = new Map<string, MatchTarget[]>();
  for (const t of input.targets) {
    const k = normaliseCampaignName(t.expectedName);
    (byName.get(k) ?? byName.set(k, []).get(k)!).push(t);
  }
  const exactOrder = [...open].sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || a.id.localeCompare(b.id));
  for (const c of exactOrder) {
    const candidates = (byName.get(normaliseCampaignName(c.name)) ?? []).filter(t => !takenTargets.has(t.key) && ok(t, c));
    if (!candidates.length) continue;
    const t = candidates.length === 1 ? candidates[0] : candidates.find(x => x.date === c.date) ?? null;
    if (!t) continue; // ambiguous
    takenTargets.add(t.key);
    takenCampaigns.add(c.id);
    matches.push({ campaignId: c.id, campaignName: c.name, targetKey: t.key, how: "exact", score: 1 });
  }

  // 2. Same day + similar name, best pairs first.
  const pairs: Array<{ c: MatchCampaign; t: MatchTarget; score: number }> = [];
  for (const c of open) {
    if (takenCampaigns.has(c.id)) continue;
    for (const t of input.targets) {
      if (takenTargets.has(t.key) || t.date !== c.date || !ok(t, c)) continue;
      pairs.push({ c, t, score: campaignTargetScore(c, t) });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id) || a.t.key.localeCompare(b.t.key));
  for (const p of pairs) {
    if (takenCampaigns.has(p.c.id) || takenTargets.has(p.t.key)) continue;
    const dayTargets = input.targets.filter(t => t.date === p.c.date && !takenTargets.has(t.key));
    const dayCampaigns = open.filter(c => c.date === p.c.date && !takenCampaigns.has(c.id));
    const onlyOne = dayTargets.length === 1 && dayCampaigns.length === 1;
    if (p.score < (onlyOne && !p.t.strict ? ONLY_ONE_MIN : SIMILAR_MIN)) continue;
    // Clearly this campaign's best target, and this target's best campaign.
    const rivalT = pairs.find(q => q.c === p.c && q.t !== p.t && !takenTargets.has(q.t.key));
    const rivalC = pairs.find(q => q.t === p.t && q.c !== p.c && !takenCampaigns.has(q.c.id));
    if (rivalT && p.score - rivalT.score < SIMILAR_MARGIN) continue;
    if (rivalC && p.score - rivalC.score < SIMILAR_MARGIN) continue;
    takenTargets.add(p.t.key);
    takenCampaigns.add(p.c.id);
    matches.push({ campaignId: p.c.id, campaignName: p.c.name, targetKey: p.t.key, how: "similar", score: Math.round(p.score * 1000) / 1000 });
  }

  return { matches, unmatchedCampaignIds: open.filter(c => !takenCampaigns.has(c.id)).map(c => c.id) };
}

/** The history line for a link the matcher made. */
export function describeNameMatch(m: Pick<CampaignMatch, "how" | "campaignName">): string {
  return m.how === "exact"
    ? `linked to the Klaviyo email “${m.campaignName}” (its campaign name is this email's)`
    : `linked to the Klaviyo email “${m.campaignName}” (same day, similar name)`;
}

// ── Tidying the duplicates already in the planner ───────────────────────────
// (scripts/merge-marketing-email-duplicates.ts — dry run by default.)

export interface PlanForMerge {
  id: number;
  sendDate: string;
  subject: string;
  status: string;
  klaviyoCampaignId: string | null;
  klaviyoCampaignName: string | null;
  campaignTitle: string | null;
  campaignName: string | null;
  cycleDate: string | null;
  /** The free-text fields a merge may carry over. */
  fields: Record<string, string | null>;
  notes: string | null;
  /** Has its own approval row (plan:<id>). */
  hasPlanApproval: boolean;
}

export interface PlanMerge {
  keepId: number;
  dropId: number;
  score: number;
  /** Fields the kept one is missing, filled from the duplicate. */
  fill: Record<string, string>;
  /** The kept one's notes after the merge (null = unchanged). */
  notes: string | null;
  /** Stage after the merge (null = unchanged). */
  status: string | null;
  /** Move the duplicate's Klaviyo link to the kept one. */
  moveLink: { id: string; name: string | null } | null;
  /** Re-key the duplicate's approval to the kept one. */
  moveApproval: boolean;
}

export interface MergePlan {
  merges: PlanMerge[];
  links: Array<{ emailId: number; campaignId: string; campaignName: string; how: "exact" | "similar"; score: number }>;
}

/** Two planned emails on one day this alike are the same email. */
export const DUPLICATE_MIN = 0.6;
const STAGE_RANK: Record<string, number> = { planned: 0, created: 1, scheduled: 2, sent: 3 };

function keepFirst(a: PlanForMerge, b: PlanForMerge): [PlanForMerge, PlanForMerge] {
  const rank = (p: PlanForMerge) => (p.klaviyoCampaignId ? 4 : 0) + (p.hasPlanApproval ? 2 : 0) + (p.cycleDate ? 1 : 0);
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? [a, b] : [b, a];
  return a.id < b.id ? [a, b] : [b, a];
}

/**
 * What tidying would do: merge planned emails that are the same email
 * (same day, subject lines this alike, not linked to two different Klaviyo
 * campaigns), then link each remaining unlinked plan to the Klaviyo
 * campaign that is the same email (the matcher above). Nothing is lost: the
 * kept email takes any field it was missing, both sets of notes, the
 * furthest stage, the Klaviyo link and the approval; the duplicate is only
 * soft-deleted (its history moves across). Running it twice finds nothing.
 */
export function planEmailMerges(input: {
  plans: readonly PlanForMerge[];
  campaigns: readonly MatchCampaign[];
  linkedCampaignIds?: Iterable<string>;
  rejected?: Iterable<{ targetKey: string; campaignId: string }>;
}): MergePlan {
  const merges: PlanMerge[] = [];
  const dropped = new Set<number>();
  const byDay = new Map<string, PlanForMerge[]>();
  for (const p of input.plans) (byDay.get(p.sendDate) ?? byDay.set(p.sendDate, []).get(p.sendDate)!).push(p);
  const state = new Map(input.plans.map(p => [p.id, { ...p, fields: { ...p.fields } }]));

  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => a.id - b.id);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = state.get(sorted[i].id)!, b = state.get(sorted[j].id)!;
        if (dropped.has(a.id) || dropped.has(b.id)) continue;
        if (a.klaviyoCampaignId && b.klaviyoCampaignId && a.klaviyoCampaignId !== b.klaviyoCampaignId) continue;
        if (a.cycleDate && b.cycleDate) continue; // two slots are never one email
        const score = wordSimilarity(nameWords(a.subject), nameWords(b.subject));
        if (score < DUPLICATE_MIN) continue;
        const [keep, drop] = keepFirst(a, b);
        const fill: Record<string, string> = {};
        for (const [k, v] of Object.entries(drop.fields)) if (v && !keep.fields[k]) { fill[k] = v; keep.fields[k] = v; }
        let notes: string | null = null;
        const kn = (keep.notes ?? "").trim(), dn = (drop.notes ?? "").trim();
        if (dn && dn !== kn && !kn.includes(dn)) {
          notes = kn ? `${kn}\n\n(From the duplicate “${drop.subject}”:)\n${dn}` : dn;
          keep.notes = notes;
        }
        const status = (STAGE_RANK[drop.status] ?? 0) > (STAGE_RANK[keep.status] ?? 0) ? drop.status : null;
        if (status) keep.status = status;
        const moveLink = !keep.klaviyoCampaignId && drop.klaviyoCampaignId ? { id: drop.klaviyoCampaignId, name: drop.klaviyoCampaignName } : null;
        if (moveLink) { keep.klaviyoCampaignId = moveLink.id; keep.klaviyoCampaignName = moveLink.name; }
        const moveApproval = drop.hasPlanApproval && !keep.hasPlanApproval && !keep.klaviyoCampaignId;
        if (moveApproval) keep.hasPlanApproval = true;
        merges.push({ keepId: keep.id, dropId: drop.id, score: Math.round(score * 1000) / 1000, fill, notes, status, moveLink, moveApproval });
        dropped.add(drop.id);
      }
    }
  }

  const remaining = [...state.values()].filter(p => !dropped.has(p.id));
  const linked = new Set(input.linkedCampaignIds ?? []);
  for (const p of remaining) if (p.klaviyoCampaignId) linked.add(p.klaviyoCampaignId);
  const { matches } = matchCampaignsToTargets({
    targets: remaining.filter(p => !p.klaviyoCampaignId).map(p => ({
      key: `plan:${p.id}`, date: p.sendDate, subject: p.subject,
      expectedName: p.campaignName ?? plannedCampaignName(p.sendDate, p.campaignTitle, p.subject),
    })),
    campaigns: input.campaigns,
    linkedCampaignIds: linked,
    rejected: input.rejected,
  });
  return {
    merges,
    links: matches.map(m => ({ emailId: Number(m.targetKey.slice(5)), campaignId: m.campaignId, campaignName: m.campaignName, how: m.how, score: m.score })),
  };
}
