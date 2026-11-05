/**
 * Runs the 2:16 order check (rules: dispatch-cutoff-rules.ts) and keeps its
 * alert in app_settings: one a day, shared by every screen.
 */
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getRecentUnfulfilledOrders } from "../services/shopify";
import { ensureFreshDisputes, loadOpenDisputes } from "./order-disputes-store";
import { DISPUTE_ON_DEMAND_MIN_AGE_MS, isHeldForChargeback } from "./order-disputes";
import { londonDateString, londonMinuteOfDay } from "./london-time";
import { alertToShow, hasGivenUp, isCheckDay, isCheckDue, ordersMissingCutoff, type CutoffAlert } from "./dispatch-cutoff-rules";

const KEY = "dispatch_cutoff_alert";
const TICK_MS = 60_000;
/** Enough to see yesterday's orders with tomorrow's date. */
const DAYS_BACK = 7;

async function readAlert(): Promise<CutoffAlert | null> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, KEY));
  if (!row?.value) return null;
  try { return JSON.parse(row.value) as CutoffAlert; } catch { return null; }
}

async function writeAlert(alert: CutoffAlert): Promise<void> {
  const value = JSON.stringify(alert);
  await db.insert(appSettingsTable).values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
}

async function findMissing(today: string) {
  // An order held for a chargeback is off the pack list on purpose.
  await ensureFreshDisputes(DISPUTE_ON_DEMAND_MIN_AGE_MS);
  const held = new Set((await loadOpenDisputes()).keys());
  const orders = await getRecentUnfulfilledOrders(DAYS_BACK);
  return ordersMissingCutoff(orders.filter(o => !isHeldForChargeback(o, held)), today);
}

export async function currentCutoffAlert(): Promise<CutoffAlert | null> {
  return alertToShow(await readAlert(), londonDateString());
}

/** "Check again": all clear ends it for the day; otherwise the list updates.
 *  Throws if Shopify can't be read, and the alert stays as it was. */
export async function recheckCutoff(): Promise<CutoffAlert | null> {
  const today = londonDateString();
  const orders = await findMissing(today);
  const alert: CutoffAlert = { date: today, orders, failed: false, closed: orders.length === 0, checkedAt: new Date().toISOString() };
  await writeAlert(alert);
  return alertToShow(alert, today);
}

/** Someone has dealt with it: gone for the day, on every screen. */
export async function dismissCutoff(): Promise<void> {
  const alert = await readAlert();
  if (alert) await writeAlert({ ...alert, closed: true });
}

async function tick(): Promise<void> {
  const minute = londonMinuteOfDay();
  const today = londonDateString();
  if (!isCheckDue(minute) || !isCheckDay(today)) return;
  if ((await readAlert())?.date === today) return;
  try {
    const orders = await findMissing(today);
    await writeAlert({ date: today, orders, failed: false, closed: false, checkedAt: new Date().toISOString() });
    console.log(`[dispatch-cutoff] 2:16 check: ${orders.length} order(s) to look at`);
  } catch (err) {
    console.warn("[dispatch-cutoff] check failed (will retry):", err);
    if (hasGivenUp(minute)) {
      await writeAlert({ date: today, orders: [], failed: true, closed: false, checkedAt: new Date().toISOString() });
    }
  }
}

export function startDispatchCutoffScheduler(): void {
  const run = () => tick().catch(err => console.warn("[dispatch-cutoff] tick failed:", err));
  setTimeout(run, 30_000);
  setInterval(run, TICK_MS).unref();
}
