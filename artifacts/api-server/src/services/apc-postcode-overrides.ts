/**
 * What APC customer service told us about a postcode, applied on top of
 * APC's POSTINFO table (Graeme, 2026-10-02). Pure — no database, no clock
 * of its own (callers pass `now`), so every rule is unit-tested.
 *
 * The case: KA3 (depot 274) is listed with Saturday delivery by 10:30, yet
 * APC refused a Saturday booking "NO Services available". The packer calls
 * APC Customer Service and records what they said:
 *
 *   permanent  → that service is treated as NOT available for the outward
 *                code from now on: the postcode card shows "✗ No Saturday
 *                delivery — confirmed by APC on 2 Oct, permanent", the
 *                Reschedule pop-up warns against Saturdays, and the advice
 *                is simply "Reschedule — APC confirmed no Saturday service
 *                here".
 *   temporary  → the table's answer still stands, but the card carries an
 *                amber "Temporary Saturday restriction reported 2 Oct by
 *                Grant" line and the advice is "Reschedule this one". It
 *                lapses on its own after TEMPORARY_RESTRICTION_DAYS, or
 *                when someone clears it.
 *
 * Where several live records exist for the same outward code and service,
 * the most recently recorded one wins (a later call supersedes an earlier).
 */

/** How long a reported TEMPORARY restriction counts before it lapses on its
 *  own. Two weeks: long enough to cover a depot problem for the next few
 *  dispatch days, short enough that a stale report can't quietly block a
 *  postcode for good. */
export const TEMPORARY_RESTRICTION_DAYS = 14;

export type OverrideService = "saturday" | "weekday";
export type OverrideKind = "temporary" | "permanent";

export interface PostcodeOverride {
  id: number;
  outward: string;
  service: OverrideService;
  kind: OverrideKind;
  note: string | null;
  depot: string | null;
  recordedByName: string | null;
  /** Optional: only needed to decide who may clear it. */
  recordedById?: number | null;
  recordedAt: Date | string;
  clearedAt: Date | string | null;
}

/** An override as the browser sees it on a postcode card. */
export interface AppliedRestriction {
  id: number;
  kind: OverrideKind;
  /** "2 Oct" — London calendar day it was recorded. */
  recordedOn: string;
  recordedByName: string | null;
  note: string | null;
  /** "16 Oct" for a temporary restriction; null for a permanent one. */
  expiresOn: string | null;
  /** The plain-English line for the card. */
  label: string;
}

export interface PostcodeRestrictions {
  saturday: AppliedRestriction | null;
  weekday: AppliedRestriction | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/** "2 Oct", in London — what the floor reads, whatever the server's zone. */
export function shortLondonDate(d: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(toDate(d));
}

/** When a temporary restriction lapses; null for permanent ones. */
export function overrideExpiresAt(o: Pick<PostcodeOverride, "kind" | "recordedAt">): Date | null {
  if (o.kind !== "temporary") return null;
  return new Date(toDate(o.recordedAt).getTime() + TEMPORARY_RESTRICTION_DAYS * DAY_MS);
}

/** Still counts: not cleared, and (if temporary) not yet expired. */
export function isOverrideActive(o: Pick<PostcodeOverride, "kind" | "recordedAt" | "clearedAt">, now: Date): boolean {
  if (o.clearedAt) return false;
  const expires = overrideExpiresAt(o);
  return expires === null || now.getTime() < expires.getTime();
}

/** The live overrides, newest first. */
export function activeOverrides<T extends PostcodeOverride>(all: readonly T[], now: Date): T[] {
  return all
    .filter(o => isOverrideActive(o, now))
    .sort((a, b) => toDate(b.recordedAt).getTime() - toDate(a.recordedAt).getTime());
}

function serviceWord(service: OverrideService): string {
  return service === "saturday" ? "Saturday" : "next-day weekday";
}

function restrictionLabel(o: PostcodeOverride): string {
  const on = shortLondonDate(o.recordedAt);
  if (o.kind === "permanent") {
    return o.service === "saturday"
      ? `No Saturday delivery — confirmed by APC on ${on}, permanent`
      : `No next-day weekday delivery — confirmed by APC on ${on}, permanent`;
  }
  return `Temporary ${serviceWord(o.service)} restriction reported ${on}${o.recordedByName ? ` by ${o.recordedByName}` : ""}`;
}

function applied(o: PostcodeOverride): AppliedRestriction {
  const expires = overrideExpiresAt(o);
  return {
    id: o.id,
    kind: o.kind,
    recordedOn: shortLondonDate(o.recordedAt),
    recordedByName: o.recordedByName,
    note: o.note,
    expiresOn: expires ? shortLondonDate(expires) : null,
    label: restrictionLabel(o),
  };
}

/** The live restriction (if any) for each service at one outward code. */
export function restrictionsFor(outward: string, all: readonly PostcodeOverride[], now: Date): PostcodeRestrictions {
  const key = outward.trim().toUpperCase();
  const live = activeOverrides(all.filter(o => o.outward.trim().toUpperCase() === key), now);
  const sat = live.find(o => o.service === "saturday");
  const wk = live.find(o => o.service === "weekday");
  return { saturday: sat ? applied(sat) : null, weekday: wk ? applied(wk) : null };
}

/** The service facts a postcode answer carries — the part overrides change. */
export interface ServiceFacts {
  nextDay: boolean;
  weekdayCutoff: string | null;
  saturdayDelivery: boolean;
  /** Saturday cut-off ("10:30"), or null when there is no Saturday service. */
  saturday: string | null;
}

/**
 * Merge APC's answer over the table's. Permanent → the service is gone;
 * temporary → unchanged facts, restriction attached for the card to show.
 */
export function mergeOverrides<T extends ServiceFacts>(facts: T, restrictions: PostcodeRestrictions): T & { restrictions: PostcodeRestrictions } {
  const merged = { ...facts, restrictions };
  if (restrictions.saturday?.kind === "permanent") {
    merged.saturdayDelivery = false;
    merged.saturday = null;
  }
  if (restrictions.weekday?.kind === "permanent") {
    merged.nextDay = false;
    merged.weekdayCutoff = null;
  }
  return merged;
}

/** Who to call, from the contact with use_for = 'apc_customer_service'. */
export interface CallContact {
  name: string;
  phone: string | null;
}

/** The sentence telling the packer who to call and what to ask. With no
 *  contact (or no number on it) it sends them to Contacts rather than
 *  inventing a number. */
export function callPromptText(contact: CallContact | null, service: OverrideService, outward: string, depot: string): string {
  const question = `whether the ${serviceWord(service)} restriction to ${outward} (depot ${depot}) is temporary or permanent`;
  if (contact?.phone?.trim()) {
    return `Call ${contact.name} on ${contact.phone.trim()} and ask ${question}.`;
  }
  return `Find APC in Contacts and call them to ask ${question}.`;
}

/** What to tell the packer when APC refused a booking. */
export interface RefusalAdvice {
  /** call_depot: the table says the depot offers it — ring APC and record
   *  the answer. reschedule_confirmed: APC already confirmed it's gone.
   *  reschedule_temporary: a temporary restriction is on record. */
  kind: "call_depot" | "reschedule_confirmed" | "reschedule_temporary";
  service: OverrideService;
  text: string;
  /** Present for call_depot: who to call, and what the answer is about. */
  call?: { outward: string; depot: string; contactName: string | null; phone: string | null };
}

export interface RefusalFacts {
  matchedOn: string;
  depot: string;
  /** What the TABLE says (before overrides) — the call is only worth making
   *  when the table says the depot normally offers the service. */
  tableNextDay: boolean;
  tableWeekdayCutoff: string | null;
  tableSaturdayDelivery: boolean;
  tableSaturdayCutoff: string | null;
  restrictions: PostcodeRestrictions;
}

export function refusalAdvice(
  s: RefusalFacts,
  booking: { saturdayDelivery: boolean; refusedNoService: boolean },
  contact: CallContact | null,
): RefusalAdvice | null {
  if (!booking.refusedNoService) return null;
  const service: OverrideService = booking.saturdayDelivery ? "saturday" : "weekday";
  const restriction = s.restrictions[service];
  if (restriction?.kind === "permanent") {
    return {
      kind: "reschedule_confirmed", service,
      text: `Reschedule — APC confirmed no ${serviceWord(service)} service here.`,
    };
  }
  if (restriction?.kind === "temporary") {
    return { kind: "reschedule_temporary", service, text: "Reschedule this one." };
  }
  const listed = service === "saturday" ? s.tableSaturdayDelivery : s.tableNextDay;
  if (!listed) return null;
  const cutoff = service === "saturday" ? s.tableSaturdayCutoff : s.tableWeekdayCutoff;
  const normally = `Depot ${s.depot} normally takes ${serviceWord(service)} deliveries${cutoff ? ` by ${cutoff}` : ""}, but APC refused this one.`;
  return {
    kind: "call_depot", service,
    text: `${normally} ${callPromptText(contact, service, s.matchedOn, s.depot)}`,
    call: { outward: s.matchedOn, depot: s.depot, contactName: contact?.name ?? null, phone: contact?.phone?.trim() || null },
  };
}

/** The Reschedule pop-up's warnings for a chosen date, overrides applied. */
export function rescheduleDateWarnings(
  s: { matchedOn: string; saturdayDelivery: boolean; nextDay: boolean; transitDays: number | null; restrictions: PostcodeRestrictions },
  toDate: string,
): string[] {
  const warnings: string[] = [];
  // getUTCDay is safe: toDate is a plain YYYY-MM-DD parsed as UTC midnight,
  // and the weekday of a date label doesn't shift with DST.
  const isSaturday = new Date(`${toDate}T00:00:00Z`).getUTCDay() === 6;
  const sat = s.restrictions.saturday;
  if (isSaturday) {
    if (sat?.kind === "permanent") {
      warnings.push(`${toDate} is a Saturday, and APC confirmed on ${sat.recordedOn} there is NO Saturday delivery to ${s.matchedOn} (permanent). Pick a weekday.`);
    } else if (!s.saturdayDelivery) {
      warnings.push(`${toDate} is a Saturday, and APC's postcode sheet lists NO Saturday delivery for ${s.matchedOn}. Pick a weekday.`);
    } else if (sat?.kind === "temporary") {
      warnings.push(`${toDate} is a Saturday, and a temporary Saturday restriction to ${s.matchedOn} was reported on ${sat.recordedOn}${sat.recordedByName ? ` by ${sat.recordedByName}` : ""}. Pick a weekday unless APC have said it's lifted.`);
    }
  } else {
    const wk = s.restrictions.weekday;
    if (wk?.kind === "permanent") {
      warnings.push(`APC confirmed on ${wk.recordedOn} there is NO next-day weekday delivery to ${s.matchedOn} (permanent) — check the transit time with APC before promising this date.`);
    } else if (wk?.kind === "temporary") {
      warnings.push(`A temporary next-day weekday restriction to ${s.matchedOn} was reported on ${wk.recordedOn}${wk.recordedByName ? ` by ${wk.recordedByName}` : ""}.`);
    }
  }
  if (!s.nextDay && s.transitDays) {
    warnings.push(`No next-day service for ${s.matchedOn} — APC quote ${s.transitDays} days in transit, so the parcel must leave ${s.transitDays} days before this date.`);
  }
  return warnings;
}
