/**
 * When the 8am to-do review takes over the screen (Graeme, 2026-10-24:
 * "a daily, unmissable task that pops up at 8 am every day"). Pure, so the
 * rule is tested: switched on, it's 8am or later in London, it hasn't been
 * finished today, and it isn't snoozed.
 */
import { londonDateString } from "./london-time";

export const REVIEW_HOUR = 8;

export interface ReviewPrefs {
  enabled: boolean;
  lastReviewedOn: string | null;
  snoozedUntil: Date | null;
}

function londonHour(now: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number(h);
}

export function reviewDue(p: ReviewPrefs, now: Date = new Date()): boolean {
  if (!p.enabled) return false;
  if (londonHour(now) < REVIEW_HOUR) return false;
  if (p.lastReviewedOn === londonDateString(now)) return false;
  if (p.snoozedUntil && p.snoozedUntil.getTime() > now.getTime()) return false;
  return true;
}
