/**
 * Crediting an improvement to more than one person (Objectives E and H —
 * Graeme, 2026-09-24: "I did an improvement with Bodan recently, and I can
 * only assign it to me currently").
 *
 * Who an improvement is credited to is the UNION of two things:
 *
 *   improvement_submissions.credited_to   the lead — first name on the card,
 *                                         kept so everything that reads one
 *                                         name still works
 *   improvement_credits rows              everyone credited (migration 0125)
 *
 * The lead is always credited, even where some writer set only credited_to
 * and never added a row (the to-do "tag as improvement", the one-off
 * auto-submit backfill). That rule lives here, in mergeCredits, and in the
 * scoreboard's SQL — so nobody falls off a tally because one code path
 * forgot the join table.
 *
 * Pure logic only — no database — so it is unit-tested and the API and its
 * SQL can't drift from what the tests pin down.
 */

export interface CreditPerson {
  userId: number;
  name: string | null;
}

/** Nobody credits a whole shift to one fix — and a cap keeps a bad client
 *  from writing hundreds of rows. */
export const MAX_CREDITED_PEOPLE = 20;

/**
 * Clean a requested list of credited user ids: positive integers only,
 * duplicates dropped, first-mention order kept (the first is the lead),
 * capped at MAX_CREDITED_PEOPLE. An empty result means "nobody", which the
 * caller must refuse — an improvement is never credited to no one by edit.
 */
export function normaliseCreditIds(ids: ReadonlyArray<unknown>): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of ids) {
    const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_CREDITED_PEOPLE) break;
  }
  return out;
}

/**
 * The ordered list of everyone credited: the lead first, then the credit
 * rows in the order given (callers pass them sorted by position), each
 * person once. A null lead with no rows is "not credited yet".
 */
export function mergeCredits(
  lead: { userId: number | null; name: string | null },
  rows: ReadonlyArray<CreditPerson>,
): CreditPerson[] {
  const out: CreditPerson[] = [];
  const seen = new Set<number>();
  const add = (p: CreditPerson) => {
    if (seen.has(p.userId)) {
      // A row can carry a name the lead's snapshot lacked — keep the better one.
      const existing = out.find(o => o.userId === p.userId);
      if (existing && !existing.name && p.name) existing.name = p.name;
      return;
    }
    seen.add(p.userId);
    out.push({ userId: p.userId, name: p.name });
  };
  if (lead.userId != null) add({ userId: lead.userId, name: lead.name });
  for (const r of rows) add(r);
  return out;
}

/**
 * Put `leadId` at the front of a credit list without dropping anyone — how
 * the Fix queue credits the reporter of a finished improvement while keeping
 * whoever was already credited on it.
 */
export function withLead(ids: ReadonlyArray<number>, leadId: number | null): number[] {
  const rest = ids.filter(id => id !== leadId);
  return leadId == null ? [...rest] : [leadId, ...rest];
}

/**
 * Names as a person would say them: "Graeme", "Graeme & Bodan",
 * "Graeme, Bodan & Lorna". Blank names are skipped; nobody → null so the
 * screen can fall back to its own wording ("Team effort", "Nobody yet").
 */
export function formatCreditNames(names: ReadonlyArray<string | null | undefined>): string | null {
  const clean = names.map(n => (n ?? "").trim()).filter(n => n.length > 0);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0]!;
  return `${clean.slice(0, -1).join(", ")} & ${clean[clean.length - 1]}`;
}

/** Is this person one of the credited people? */
export function isCredited(credits: ReadonlyArray<CreditPerson>, userId: number | null | undefined): boolean {
  return userId != null && credits.some(c => c.userId === userId);
}
