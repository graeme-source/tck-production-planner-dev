/**
 * The email plan's data (Graeme, 2026-10-14; migration 0194): loading the
 * offer cycle's config, and turning a cycle slot into a stored planned
 * email ("materialising" it) the moment someone acts on it — a note, the
 * Scheduled tick, a link to Klaviyo, or Klaviyo's campaign name matching
 * it. Objective I. The rules themselves are pure, in
 * @workspace/marketing-calendar (email-cycle.ts).
 *
 * One live planned email per slot day (unique index on cycle_date), so two
 * people acting on the same slot at once get the same row.
 */
import {
  db, marketingCycleOffersTable, marketingCyclePausesTable, marketingCycleSettingsTable, marketingCycleWeeksTable,
  marketingEmailHistoryTable, marketingEmailsTable, marketingKeyDatesTable,
} from "@workspace/db";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import {
  EMAIL_TYPE_LABELS, cycleSlotOn, fillProduct, normaliseFreeIdeas, normaliseSubjects, normaliseWeeklyPlan, startOfWeek,
  type CycleConfig, type KeyDate,
} from "@workspace/marketing-calendar";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = Tx | typeof db;
type EmailRow = typeof marketingEmailsTable.$inferSelect;

export interface Actor { id: number | null; name: string }

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

export type OfferRow = typeof marketingCycleOffersTable.$inferSelect;

export function offerJson(o: OfferRow) {
  return {
    id: o.id, position: o.position, code: o.code, name: o.name, tag: o.tag, colour: o.colour,
    featuresProduct: o.featuresProduct, subjects: normaliseSubjects(o.subjects),
  };
}

/** Everything the cycle needs (deleted rows left out). Before the settings
 *  row exists the cycle simply has no plan — nothing is invented. */
export async function loadCycle(tx: Db = db) {
  const [[settings], offers, pauses, keyDates] = await Promise.all([
    tx.select().from(marketingCycleSettingsTable).where(eq(marketingCycleSettingsTable.id, 1)),
    tx.select().from(marketingCycleOffersTable).where(isNull(marketingCycleOffersTable.deletedAt))
      .orderBy(asc(marketingCycleOffersTable.position), asc(marketingCycleOffersTable.id)),
    tx.select().from(marketingCyclePausesTable).where(isNull(marketingCyclePausesTable.deletedAt))
      .orderBy(asc(marketingCyclePausesTable.startDate), asc(marketingCyclePausesTable.id)),
    tx.select().from(marketingKeyDatesTable).where(isNull(marketingKeyDatesTable.deletedAt))
      .orderBy(asc(marketingKeyDatesTable.date), asc(marketingKeyDatesTable.id)),
  ]);
  const config: CycleConfig = {
    startDate: settings?.startDate ?? startOfWeek(londonToday()),
    weeklyPlan: normaliseWeeklyPlan(settings?.weeklyPlan ?? []),
    offers: offers.map(offerJson),
    pauses: pauses.map(p => ({ id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate })),
    freeIdeas: normaliseFreeIdeas(settings?.freeSlotIdeas ?? []),
  };
  const kd: KeyDate[] = keyDates.map(k => ({ id: k.id, date: k.date, name: k.name, big: k.big }));
  return {
    config,
    keyDates: kd,
    settingsUpdatedBy: settings?.updatedByName ?? null,
    settingsUpdatedAt: settings?.updatedAt?.toISOString() ?? null,
    configured: settings != null,
  };
}

/** Product of the week per Monday, for weeks touching [from, to]. */
export async function loadProducts(from: string, to: string, tx: Db = db): Promise<Record<string, string | null>> {
  const rows = await tx.select().from(marketingCycleWeeksTable)
    .where(and(gte(marketingCycleWeeksTable.weekStart, startOfWeek(from)), lte(marketingCycleWeeksTable.weekStart, to)));
  return Object.fromEntries(rows.map(r => [r.weekStart, r.product]));
}

export type MaterialiseResult = { status: 200; row: EmailRow; created: boolean } | { status: 404; error: string };

/**
 * The stored planned email for the cycle slot on `date`, made now if it
 * isn't stored yet (idempotent). 404 when the cycle has no email that day.
 */
export async function materialiseSlot(tx: Tx, date: string, user: Actor, why = "from the email plan"): Promise<MaterialiseResult> {
  const existing = async () => (await tx.select().from(marketingEmailsTable)
    .where(and(eq(marketingEmailsTable.cycleDate, date), isNull(marketingEmailsTable.deletedAt))))[0] ?? null;
  const found = await existing();
  if (found) return { status: 200, row: found, created: false };

  const { config } = await loadCycle(tx);
  const products = await loadProducts(date, date, tx);
  const product = products[startOfWeek(date)] ?? null;
  const slot = cycleSlotOn(date, config, product);
  if (!slot) return { status: 404, error: "The email plan has no email on that day." };

  const offerText = slot.type === "free_slot" ? (slot.idea ?? null) : slot.offer ? fillProduct(slot.offer.name,slot.offer.featuresProduct ? product : null) : null;
  const inserted = await tx.insert(marketingEmailsTable).values({
    sendDate: date,
    subject: slot.subject,
    offer: offerText,
    status: "planned",
    cycleDate: date,
    emailType: slot.type,
    cycleOfferId: slot.type === "free_slot" ? null : slot.offer?.id ?? null,
    campaignName: slot.campaignName,
    createdById: user.id, createdByName: user.name,
    updatedById: user.id, updatedByName: user.name,
  }).onConflictDoNothing().returning();
  const row = inserted[0];
  if (!row) {
    // Someone else made it a moment ago — theirs stands.
    const again = await existing();
    if (again) return { status: 200, row: again, created: false };
    return { status: 404, error: "Couldn't add that email — try again." };
  }
  const what = slot.type === "free_slot"
    ? `the free slot (${slot.idea ?? "random or creative"})`
    : `Offer ${slot.offerNumber} – ${EMAIL_TYPE_LABELS[slot.type]}`;
  await tx.insert(marketingEmailHistoryTable).values({
    emailId: row.id, userId: user.id, userName: user.name, action: "created", summary: `added ${what} ${why}`,
  });
  return { status: 200, row, created: true };
}
