/**
 * Phases and the offer library (Graeme, 2026-10-20) — the pure rules, shared
 * by the server (routes/marketing-calendar.ts, routes/marketing-offers.ts)
 * and the page. Tested in phases.test.ts.
 *
 * A PHASE is a dated period on the calendar ("Halloween Week") with zero or
 * more OFFERS ("Free pack on orders over £39.95"), an optional customer
 * group and notes. Offers are text: the library is a list to pick from, and
 * typing a new one on a phase adds it there. A phase keeps its own copy of
 * the text, so editing or deleting a library offer never changes a phase.
 */
import { addDays, daysBetween } from "./calendar";

/** The old one-day "note" events (2026-10-01). They stay in the database
 *  but are not phases: the calendar never lists them. */
export const NOTE_EVENT_TYPE = "note";

// ── Customer group ─────────────────────────────────────────────────────────

export const CUSTOMER_GROUPS = ["all", "new", "returning", "subscription"] as const;
export type CustomerGroup = (typeof CUSTOMER_GROUPS)[number];

export const CUSTOMER_GROUP_LABELS: Record<CustomerGroup, string> = {
  all: "All customers",
  new: "New customers only",
  returning: "Returning customers",
  subscription: "Subscription customers",
};

export function isCustomerGroup(v: unknown): v is CustomerGroup {
  return typeof v === "string" && (CUSTOMER_GROUPS as readonly string[]).includes(v);
}

/** The small chip on a phase bar — null for "all" (the default shows nothing). */
export function customerGroupChip(group: string | null | undefined): string | null {
  switch (group) {
    case "new": return "New customers";
    case "returning": return "Returning";
    case "subscription": return "Subscribers";
    default: return null;
  }
}

// ── Offer text ─────────────────────────────────────────────────────────────

/** Trimmed, single-spaced — how an offer is stored. */
export function cleanOfferText(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ");
}

/** Two offers are the same when they read the same, ignoring case and spaces. */
export function offerKey(text: string | null | undefined): string {
  return cleanOfferText(text).toLowerCase();
}

/** Cleaned, empties dropped, first spelling of each kept, order kept. */
export function dedupeOffers(texts: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const clean = cleanOfferText(t);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/** The phase's offers that the library doesn't have yet (live or archived). */
export function offersMissingFromLibrary(offers: readonly string[], library: ReadonlyArray<{ text: string }>): string[] {
  const have = new Set(library.map(o => offerKey(o.text)));
  return dedupeOffers(offers).filter(o => !have.has(offerKey(o)));
}

/** The old single `offer` column, kept in step for older readers. */
export function offersSummary(offers: readonly string[]): string | null {
  const list = dedupeOffers(offers);
  return list.length ? list.join("; ") : null;
}

/**
 * What to offer while someone types on a phase: live (not archived) library
 * offers not already on the phase, those containing the typed words first
 * (all of them must appear), at most `limit`.
 */
export function offerSuggestions<T extends { text: string; archived?: boolean }>(
  library: readonly T[], typed: string, chosen: readonly string[], limit = 8,
): T[] {
  const taken = new Set(chosen.map(offerKey));
  const words = offerKey(typed).split(" ").filter(Boolean);
  return library
    .filter(o => !o.archived && !taken.has(offerKey(o.text)))
    .filter(o => { const k = offerKey(o.text); return words.every(w => k.includes(w)); })
    .slice(0, limit);
}

// ── Re-using a past phase ──────────────────────────────────────────────────

export interface PhaseLike {
  title: string;
  startDate: string;
  endDate: string;
  offers: readonly string[];
  customerGroup: string;
  notes: string | null;
}

/** A copy of a past phase starting on `newStart`, the same number of days long. */
export function reusePhase(p: PhaseLike, newStart: string): {
  title: string; startDate: string; endDate: string; offers: string[]; customerGroup: CustomerGroup; notes: string | null;
} {
  const length = Math.max(0, daysBetween(p.startDate, p.endDate));
  return {
    title: p.title,
    startDate: newStart,
    endDate: addDays(newStart, length),
    offers: dedupeOffers(p.offers),
    customerGroup: isCustomerGroup(p.customerGroup) ? p.customerGroup : "all",
    notes: p.notes,
  };
}

/** Past phases matching a search (every word in the name or an offer), newest first. */
export function searchPhases<T extends { title: string; offers: readonly string[]; startDate: string; id: number }>(
  phases: readonly T[], query: string,
): T[] {
  const words = offerKey(query).split(" ").filter(Boolean);
  return phases
    .filter(p => {
      const hay = offerKey([p.title, ...p.offers].join(" "));
      return words.every(w => hay.includes(w));
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id);
}

/** How many live phases use each offer (by offerKey). */
export function offerUsage(phases: ReadonlyArray<{ offers: readonly string[] }>): Map<string, number> {
  const n = new Map<string, number>();
  for (const p of phases) for (const o of dedupeOffers(p.offers)) n.set(offerKey(o), (n.get(offerKey(o)) ?? 0) + 1);
  return n;
}

/**
 * The offers running for everyone today (a survey's final page shows them):
 * phases covering `today` whose customer group is "all", earliest start
 * first. Offers still carrying a "(Product)"-style placeholder are left out —
 * a customer must never read one.
 */
export function currentPublicOffers(
  phases: ReadonlyArray<{ startDate: string; endDate: string; offers: readonly string[]; customerGroup: string }>,
  today: string,
): string[] {
  const running = phases
    .filter(p => p.startDate <= today && p.endDate >= today && (p.customerGroup ?? "all") === "all")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return dedupeOffers(running.flatMap(p => p.offers)).filter(o => !/\(\s*product\s*\)/i.test(o));
}
