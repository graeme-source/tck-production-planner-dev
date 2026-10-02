/**
 * The database half of the APC postcode check: the recorded APC answers
 * (apc_postcode_overrides, migration 0144) and who to call (the contact
 * with use_for = 'apc_customer_service', migration 0143). The rules that
 * use them are pure, in services/apc-postcode-overrides.ts.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { TEMPORARY_RESTRICTION_DAYS, type PostcodeOverride, type CallContact } from "../services/apc-postcode-overrides";

/** The machine key the APC booking-failure call prompt finds its contact by
 *  — so the name and number live only in the Contacts directory. */
export const APC_CUSTOMER_SERVICE_USE_FOR = "apc_customer_service";

type OverrideRow = {
  id: number; outward: string; service: string; kind: string; note: string | null; depot: string | null;
  recorded_by_name: string | null; recorded_by_id?: number | null; recorded_at: string; cleared_at: string | null;
};

export function overrideFromRow(r: OverrideRow): PostcodeOverride {
  return {
    id: Number(r.id),
    outward: r.outward,
    service: r.service === "weekday" ? "weekday" : "saturday",
    kind: r.kind === "permanent" ? "permanent" : "temporary",
    note: r.note,
    depot: r.depot,
    recordedByName: r.recorded_by_name,
    recordedById: r.recorded_by_id == null ? null : Number(r.recorded_by_id),
    // TIMESTAMP columns hold UTC (NOW() on a UTC server); mark them so.
    recordedAt: new Date(`${String(r.recorded_at).replace(" ", "T")}Z`),
    clearedAt: r.cleared_at,
  };
}

/** Every override that could still be live: uncleared, and permanent or
 *  inside the temporary window (the pure rules make the final call). */
export async function loadPostcodeOverrides(): Promise<PostcodeOverride[]> {
  const rows = await db.execute<OverrideRow>(sql`
    SELECT id, outward, service, kind, note, depot, recorded_by_name, recorded_by_id,
           to_char(recorded_at, 'YYYY-MM-DD HH24:MI:SS') AS recorded_at, cleared_at
    FROM apc_postcode_overrides
    WHERE cleared_at IS NULL
      AND (kind = 'permanent' OR recorded_at > NOW() - make_interval(days => ${TEMPORARY_RESTRICTION_DAYS}))
    ORDER BY recorded_at DESC
  `);
  return rows.rows.map(overrideFromRow);
}

export async function loadApcCallContact(): Promise<CallContact | null> {
  const rows = await db.execute<{ name: string; phone: string | null }>(sql`
    SELECT name, phone FROM contacts
    WHERE use_for = ${APC_CUSTOMER_SERVICE_USE_FOR} AND deleted_at IS NULL
    ORDER BY id LIMIT 1
  `);
  return rows.rows[0] ?? null;
}

/** Both, for a booking or reschedule screen. A database hiccup here must
 *  not stop a booking report or a reschedule preview: it degrades to the
 *  plain table answer and a "find APC in Contacts" prompt, and says so in
 *  the log. */
export async function loadPostcodeContext(): Promise<{ overrides: PostcodeOverride[]; contact: CallContact | null }> {
  const [overrides, contact] = await Promise.all([
    loadPostcodeOverrides().catch((err: unknown) => {
      console.warn("[apc-postcode] could not load postcode overrides — using the table alone:", err instanceof Error ? err.message : err);
      return [] as PostcodeOverride[];
    }),
    loadApcCallContact().catch((err: unknown) => {
      console.warn("[apc-postcode] could not load the APC customer-service contact:", err instanceof Error ? err.message : err);
      return null;
    }),
  ]);
  return { overrides, contact };
}
