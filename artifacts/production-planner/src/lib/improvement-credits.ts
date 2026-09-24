/**
 * The screen's half of multi-person improvement credit (Objectives E and H —
 * Graeme, 2026-09-24: "I did an improvement with Bodan recently, and I can
 * only assign it to me currently").
 *
 * The server decides who is credited and sends the names already joined
 * ("Graeme & Bodan" — lib/db/src/improvement-credits.ts). This file is only
 * the picker's rules and the one fallback chain every screen uses to name
 * the people, so no card shows just the first of them.
 */

export interface CreditedImprovement {
  /** Everyone credited, lead first, joined for display. Null = nobody yet. */
  creditNames?: string | null;
  /** The lead alone — only a fallback for an older server response. */
  creditedToName?: string | null;
  submittedByName?: string | null;
  credits?: Array<{ userId: number; name: string | null }>;
}

/**
 * Tap a person's chip: in if they were out, out if they were in — except
 * the last person, who stays. An improvement can't be credited to nobody by
 * a stray tap, so the recorder (ticked by default) can step aside only once
 * someone else is ticked.
 */
export function toggleCreditId(selected: ReadonlyArray<number>, id: number): number[] {
  if (selected.includes(id)) {
    return selected.length <= 1 ? [...selected] : selected.filter(s => s !== id);
  }
  return [...selected, id];
}

/** Would tapping this chip do nothing because it's the last one ticked? */
export function isLockedCredit(selected: ReadonlyArray<number>, id: number): boolean {
  return selected.length === 1 && selected[0] === id;
}

/**
 * Chips in a steady order: whoever's ticked first (in the order they were
 * ticked — the first is the lead), then everyone else A–Z. Optional filter
 * matches names case-insensitively but never hides a ticked person.
 */
export function orderCreditPeople<P extends { id: number; name: string }>(
  people: ReadonlyArray<P>,
  selected: ReadonlyArray<number>,
  filter = "",
): P[] {
  const byId = new Map(people.map(p => [p.id, p]));
  const ticked = selected.map(id => byId.get(id)).filter((p): p is P => p != null);
  const q = filter.trim().toLowerCase();
  const rest = people
    .filter(p => !selected.includes(p.id))
    .filter(p => q === "" || p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...ticked, ...rest];
}

/** Who to name on a card: everyone credited, else the lead, else whoever
 *  logged it. Null when none of those is known. */
export function creditLabel(item: CreditedImprovement): string | null {
  return item.creditNames || item.creditedToName || item.submittedByName || null;
}

/** Is this person one of the credited people (not just the first)? */
export function isCreditedTo(item: CreditedImprovement, userId: number | null | undefined): boolean {
  return userId != null && (item.credits ?? []).some(c => c.userId === userId);
}

/** The credited people's ids, lead first — the picker's starting point. */
export function creditIds(item: CreditedImprovement): number[] {
  return (item.credits ?? []).map(c => c.userId);
}
