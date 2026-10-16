/**
 * This week's offer from the email plan, for a survey's final page. Reads
 * the plan; never writes. Any failure means "no offer" — the final page
 * simply leaves the offer out rather than breaking the survey.
 * Rules are pure in survey-final-page.ts (currentOfferText). Objective I.
 */
import { startOfWeek } from "@workspace/marketing-calendar";
import { loadCycle, loadProducts } from "./email-cycle-data";
import { londonDateString } from "./london-time";
import { currentOfferText } from "./survey-final-page";

export async function loadCurrentOfferText(now: Date = new Date()): Promise<string | null> {
  try {
    const today = londonDateString(now);
    const { config, configured } = await loadCycle();
    if (!configured) return null;
    const products = await loadProducts(today, today);
    return currentOfferText({ config, configured, today, weekProduct: products[startOfWeek(today)] ?? null });
  } catch (err) {
    console.error("[survey-offer] current offer lookup failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
