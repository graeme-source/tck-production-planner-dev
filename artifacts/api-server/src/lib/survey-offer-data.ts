/**
 * Today's offer from the marketing calendar's phases, for a survey's final
 * page (2026-10-20 — it used to come from the retired weekly offer cycle).
 * Reads; never writes. Any failure means "no offer" — the final page simply
 * leaves the offer out rather than breaking the survey.
 * Rules are pure in survey-final-page.ts (currentOfferText). Objective I.
 */
import { db, marketingEventsTable } from "@workspace/db";
import { and, gte, isNull, lte, ne } from "drizzle-orm";
import { NOTE_EVENT_TYPE } from "@workspace/marketing-calendar";
import { londonDateString } from "./london-time";
import { currentOfferText } from "./survey-final-page";

export async function loadCurrentOfferText(now: Date = new Date()): Promise<string | null> {
  try {
    const today = londonDateString(now);
    const phases = await db.select({
      startDate: marketingEventsTable.startDate,
      endDate: marketingEventsTable.endDate,
      offers: marketingEventsTable.offers,
      customerGroup: marketingEventsTable.customerGroup,
    }).from(marketingEventsTable).where(and(
      isNull(marketingEventsTable.deletedAt),
      ne(marketingEventsTable.eventType, NOTE_EVENT_TYPE),
      lte(marketingEventsTable.startDate, today),
      gte(marketingEventsTable.endDate, today),
    ));
    return currentOfferText({ phases, today });
  } catch (err) {
    console.error("[survey-offer] current offer lookup failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
