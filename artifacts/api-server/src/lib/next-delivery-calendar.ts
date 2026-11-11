/**
 * Loads the delivery calendar for next-delivery-after-weekend.ts: Zapiet's
 * checkout calendar (blackouts, disabled weekdays) plus our own closures.
 */
import { getStockGateSettings, zapietCalendar } from "./stock-gating";
import { getNonDispatchDates } from "../routes/production-plans";
import { parseZapietDisabled, type DeliveryCalendar } from "./next-delivery-after-weekend";



let cached: { at: number; value: { calendar: DeliveryCalendar; zapiet: boolean } } | null = null;

/** The checkout's delivery calendar from Zapiet plus our closure days,
 *  cached 10 minutes. If Zapiet can't be read, our closures alone (and the
 *  usual no-Sunday/Monday rule) — `zapiet: false` says so. */
export async function loadDeliveryCalendar(): Promise<{ calendar: DeliveryCalendar; zapiet: boolean }> {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
  const nonDispatchDates = await getNonDispatchDates();
  let value: { calendar: DeliveryCalendar; zapiet: boolean };
  try {
    const { zapietLocationId } = await getStockGateSettings();
    const cal = zapietLocationId ? await zapietCalendar(zapietLocationId, []) : null;
    if (!cal) throw new Error("no Zapiet calendar");
    const parsed = parseZapietDisabled(cal.disabled);
    value = {
      calendar: parsed.allowList
        ? { disabledWeekdays: parsed.weekdays, blockedDates: new Set(), allowedDates: parsed.dates, nonDispatchDates }
        : { disabledWeekdays: parsed.weekdays, blockedDates: parsed.dates, nonDispatchDates },
      zapiet: true,
    };
  } catch (err) {
    console.warn("[next-delivery] Zapiet calendar unavailable, using our closures only:", err instanceof Error ? err.message : err);
    value = { calendar: { disabledWeekdays: new Set([0, 1]), blockedDates: new Set(), nonDispatchDates }, zapiet: false }; // Sunday, Monday
  }
  cached = { at: Date.now(), value };
  return value;
}
