/**
 * The words and the ready-to-paste script for the "Google Ads spend" card
 * in Numbers → ROAS targets (Graeme, 2026-10-11). Objective I. Pure, tested.
 */

/** Stands in for the key when the page no longer has it (it's shown once). */
export const KEY_STAND_IN = "PASTE-YOUR-KEY-HERE";

/** The script with this app's address and the key filled in. */
export function fillScript(
  template: string,
  placeholders: { url: string; key: string },
  ingestUrl: string,
  key: string | null,
): string {
  return template
    .split(placeholders.url).join(ingestUrl)
    .split(placeholders.key).join(key ?? KEY_STAND_IN);
}

export type LinkTone = "good" | "stale" | "waiting" | "off";

export interface LinkHealth {
  tone: LinkTone;
  headline: string;
  detail: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** "3 hours ago" style, coarse on purpose. */
export function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

/** A daily script that hasn't been heard from in this long has stopped. */
export const STALE_AFTER_HOURS = 36;

/**
 * Is the link working? One line for the card's header, plus the detail.
 * Only facts the server has: when it last heard from the script, and what.
 */
export function linkHealth(s: {
  hasKey: boolean;
  lastReceivedAt: string | null;
  lastDayCount: number | null;
  lastFrom: string | null;
  lastTo: string | null;
}, now: number): LinkHealth {
  if (!s.hasKey) {
    return s.lastReceivedAt
      ? { tone: "off", headline: "Turned off", detail: "No key, so the script's sends are refused. Make a new key to turn it back on." }
      : { tone: "off", headline: "Not set up yet", detail: "Make a key, then follow the steps below." };
  }
  if (!s.lastReceivedAt) {
    return { tone: "waiting", headline: "Waiting for the first send", detail: "Nothing has arrived from Google Ads yet. Run the script once with Preview to check." };
  }
  const age = now - new Date(s.lastReceivedAt).getTime();
  const span = s.lastFrom && s.lastTo
    ? (s.lastFrom === s.lastTo ? day(s.lastFrom) : `${day(s.lastFrom)} – ${day(s.lastTo)}`)
    : null;
  const what = `${s.lastDayCount ?? 0} day${s.lastDayCount === 1 ? "" : "s"}${span ? ` (${span})` : ""}`;
  if (age > STALE_AFTER_HOURS * 3_600_000) {
    return {
      tone: "stale",
      headline: `Last received ${ago(age)}`,
      detail: `${what}. Nothing for over a day — check the script's schedule in Google Ads (Tools → Bulk actions → Scripts).`,
    };
  }
  return { tone: "good", headline: `Last received ${ago(age)}`, detail: `${what}.` };
}
