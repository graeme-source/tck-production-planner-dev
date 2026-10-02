/**
 * APC's published postcode service table — what APC will actually deliver to
 * a given postcode, and when.
 *
 * APC send this out as POSTINFO.csv. Until now it lived on Graeme's desktop:
 * when a consignment came back "NO Services available", the only way to know
 * whether that postcode has ANY next-day service, or a Saturday service, was
 * to open the spreadsheet and look the outward code up by hand — before
 * deciding whether to reschedule and to what date. That lookup is the thing
 * this module does, so the answer arrives with the failure.
 *
 * The sheet is reference data from the carrier, so it is stored as APC sent
 * it (src/data/apc-postinfo.csv, verbatim) and parsed once on first use.
 * Refreshing it is a matter of replacing that file — no schema, no upload.
 *
 * Columns, in order: outward code, earliest achievable WEEKDAY delivery time,
 * Saturday delivery time, depot, area. A time in the weekday column means a
 * next-day service exists and lands by then; "2 days" / "3 days" / "5 days"
 * means there is NO next-day service and that is the transit. "-" in the
 * Saturday column means no Saturday delivery at all.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  mergeOverrides, restrictionsFor, refusalAdvice,
  type PostcodeOverride, type PostcodeRestrictions, type CallContact, type RefusalAdvice,
} from "./apc-postcode-overrides";

/** Where the sheet came from, so the advice can say what it checked. */
export const POSTINFO_SOURCE = "APC's POSTINFO postcode table (issued August 2026)";

export interface PostinfoRow {
  /** Outward code as APC list it: "MK17", "EC1A", "B1". */
  outward: string;
  /** Raw weekday cell — a time ("10:30") or a transit ("2 days"). */
  weekday: string;
  /** Raw Saturday cell; null where the sheet says "-" (no Saturday service). */
  saturday: string | null;
  depot: string;
  area: string;
}

export interface PostcodeServiceAnswer extends PostinfoRow {
  /** The postcode that was asked about, as given. */
  postcode: string;
  /** The outward code the row was found under — not always the full outward
   *  code, because APC list some London districts without their letter. */
  matchedOn: string;
  /** A next-day weekday service exists (the weekday cell is a time). */
  nextDay: boolean;
  /** The time next-day traffic lands by, when there is a next-day service. */
  weekdayCutoff: string | null;
  /** Days in transit when there is NO next-day service (2, 3, 5). */
  transitDays: number | null;
  saturdayDelivery: boolean;
  /** What APC customer service told us since the table was issued (see
   *  apc-postcode-overrides.ts). A PERMANENT one has already been applied
   *  to nextDay / saturdayDelivery above; a temporary one only rides along. */
  restrictions: PostcodeRestrictions;
  /** The table's own answer, before any override — what the depot
   *  "normally" offers, which is what makes a refusal surprising. */
  listed: { nextDay: boolean; weekdayCutoff: string | null; saturdayDelivery: boolean; saturday: string | null };
  /** One plain-English line, ready to show to whoever is packing. */
  summary: string;
}

/** Parse the sheet. Split out from the file read so it can be tested on a
 *  fixture as well as on the real file. Unparseable lines are dropped rather
 *  than thrown on: a carrier file with one odd row must not take the packing
 *  screen down with it. */
export function parsePostinfo(csv: string): Map<string, PostinfoRow> {
  const rows = new Map<string, PostinfoRow>();
  for (const line of csv.split(/\r?\n/)) {
    const cells = line.split(",").map(c => c.trim());
    if (cells.length < 3) continue;
    const outward = cells[0].toUpperCase();
    // The header row, and anything that isn't an outward code.
    if (!/^[A-Z]{1,2}\d[A-Z\d]?$/.test(outward)) continue;
    rows.set(outward, {
      outward,
      weekday: cells[1],
      saturday: cells[2] === "-" || cells[2] === "" ? null : cells[2],
      depot: cells[3] ?? "",
      area: cells[4] ?? "",
    });
  }
  return rows;
}

let cached: Map<string, PostinfoRow> | null = null;

function table(): Map<string, PostinfoRow> {
  if (!cached) {
    // Same shape as the prompt files next door: resolved from this module's
    // own directory, which survives the production ESM run (`__dirname` does
    // not exist there).
    const path = resolve(import.meta.dirname, "../data/apc-postinfo.csv");
    cached = parsePostinfo(readFileSync(path, "utf8"));
  }
  return cached;
}

/** How many postcodes the sheet covers — for the diagnostics endpoint. */
export function postinfoSize(): number {
  return table().size;
}

/** "MK17 9FX" → "MK17". Already-outward input is returned as-is. */
export function outwardCode(postcode: string): string {
  const clean = postcode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // A full UK postcode always ends in the three-character inward code.
  return clean.length > 4 || /\d[A-Z]{2}$/.test(clean.slice(-3))
    ? clean.slice(0, -3)
    : clean;
}

/** Look one postcode up in the sheet, with any recorded APC answers
 *  (`overrides`, from the apc_postcode_overrides table) applied on top.
 *  Returns null when it isn't listed — which is itself worth saying out
 *  loud rather than papering over. */
export function lookupPostcodeService(
  postcode: string | null | undefined,
  rowsOverride?: Map<string, PostinfoRow>,
  overrides: readonly PostcodeOverride[] = [],
  now: Date = new Date(),
): PostcodeServiceAnswer | null {
  if (!postcode?.trim()) return null;
  const rows = rowsOverride ?? table();
  let key = outwardCode(postcode);
  if (!key) return null;

  // London sub-districts ("N1C", "EC1A") are listed in their own right in
  // the current sheet, so the fullest key is tried first — but a future
  // issue of the file dropping one must degrade to its district, not to
  // "not listed", so trailing letters are peeled off until a row matches.
  let row = rows.get(key);
  while (!row && /[A-Z]$/.test(key) && key.length > 2) {
    key = key.slice(0, -1);
    row = rows.get(key);
  }
  if (!row) return null;

  const cutoffMatch = /^\d{1,2}:\d{2}$/.test(row.weekday);
  const transitMatch = row.weekday.match(/^(\d+)\s*days?$/i);
  const listed = {
    nextDay: cutoffMatch,
    weekdayCutoff: cutoffMatch ? row.weekday : null,
    saturdayDelivery: row.saturday !== null,
    saturday: row.saturday,
  };
  const answer: Omit<PostcodeServiceAnswer, "summary"> = mergeOverrides({
    ...row,
    postcode: postcode.trim().toUpperCase(),
    matchedOn: key,
    ...listed,
    transitDays: transitMatch ? Number(transitMatch[1]) : null,
    listed,
  }, restrictionsFor(key, overrides, now));
  return { ...answer, summary: summarise(answer) };
}

/** The sentence the packer reads. Says what was checked and what it found,
 *  because the point is to replace a manual look at the spreadsheet. */
function summarise(a: Omit<PostcodeServiceAnswer, "summary">): string {
  const weekday = a.nextDay
    ? `next-day weekday delivery by ${a.weekdayCutoff}`
    : a.transitDays
      ? `NO next-day service — ${a.transitDays} days in transit`
      : `weekday service listed as "${a.weekday}"`;
  const saturday = a.saturdayDelivery
    ? `Saturday delivery by ${a.saturday}`
    : "NO Saturday delivery";
  const notes = [a.restrictions.weekday, a.restrictions.saturday].map(r => (r ? ` ${r.label}.` : "")).join("");
  return `Checked ${POSTINFO_SOURCE} for ${a.matchedOn}: ${weekday}, ${saturday}. Depot ${a.depot}.${notes}`;
}

/** The line to show when the postcode isn't in the sheet at all. Fail loud:
 *  silence would read as "checked, and it's fine". */
export function unlistedPostcodeSummary(postcode: string): string {
  return `${outwardCode(postcode) || postcode} is not listed in ${POSTINFO_SOURCE} — check the postcode is right, then ask APC before promising a date.`;
}

/** The whole answer for one postcode, listed or not, ready to hand to the
 *  browser. */
export function postcodeServiceFor(
  postcode: string | null | undefined,
  overrides: readonly PostcodeOverride[] = [],
  now: Date = new Date(),
): { summary: string; service: PostcodeServiceAnswer | null } | null {
  if (!postcode?.trim()) return null;
  const service = lookupPostcodeService(postcode, undefined, overrides, now);
  return { summary: service ? service.summary : unlistedPostcodeSummary(postcode), service };
}

/** The postcode facts for a booking screen, as separate fields — two ticked
 *  lines read faster than one long sentence (Graeme, 2026-10-02). */
export interface PostcodeServiceView {
  matchedOn: string;
  depot: string;
  nextDay: boolean;
  weekdayCutoff: string | null;
  transitDays: number | null;
  saturdayDelivery: boolean;
  saturdayCutoff: string | null;
  source: string;
  restrictions: PostcodeRestrictions;
  /** The table's own answer before overrides (see PostcodeServiceAnswer). */
  tableNextDay: boolean;
  tableWeekdayCutoff: string | null;
  tableSaturdayDelivery: boolean;
  tableSaturdayCutoff: string | null;
}

export function postcodeServiceView(s: PostcodeServiceAnswer): PostcodeServiceView {
  return {
    matchedOn: s.matchedOn, depot: s.depot, nextDay: s.nextDay, weekdayCutoff: s.weekdayCutoff,
    transitDays: s.transitDays, saturdayDelivery: s.saturdayDelivery, saturdayCutoff: s.saturday, source: POSTINFO_SOURCE,
    restrictions: s.restrictions,
    tableNextDay: s.listed.nextDay, tableWeekdayCutoff: s.listed.weekdayCutoff,
    tableSaturdayDelivery: s.listed.saturdayDelivery, tableSaturdayCutoff: s.listed.saturday,
  };
}

/**
 * What to do when APC refuses a service. When the table says the depot
 * normally offers it (Graeme, 2026-10-02: KA1/KA3, depot 274, list Saturday
 * by 10:30 yet "NO Services available"), the packer is told to ring APC
 * customer service (`contact`, the use_for = 'apc_customer_service' entry
 * in Contacts) and record whether it's temporary or permanent; once that
 * answer is on record the advice is simply to reschedule. null when the
 * refusal matches the table or the failure wasn't a coverage refusal.
 * Pure — the rules live in apc-postcode-overrides.ts.
 */
export function postcodeRefusalAdvice(
  s: PostcodeServiceView,
  booking: { saturdayDelivery: boolean; refusedNoService: boolean },
  contact: CallContact | null = null,
): RefusalAdvice | null {
  return refusalAdvice(s, booking, contact);
}
