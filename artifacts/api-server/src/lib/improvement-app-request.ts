/**
 * Does this improvement idea read like a request to change the APP?
 * (Graeme, 2026-10-10; Objectives E and F.) Some ideas logged on the
 * improvements board are really "could we make the app do X?" — they belong
 * in the Fix queue, where the hourly Claude session reviews app issues. This
 * check only SUGGESTS them; nothing goes into the Fix queue without Graeme's
 * "Add to fix queue".
 *
 * Pure word check, no paid API: the issue pipeline's AI is the scheduled
 * Claude Code session (docs/ISSUE_PIPELINE.md), which never runs inside the
 * app — so an idea Graeme adds becomes an app issue and that session
 * triages it like any other. Tested in improvement-app-request.test.ts.
 *
 * Flagged when it was logged against the app itself, or it names at least
 * two parts of the app, or one part of the app AND asks for a change
 * ("could we…", "it would be good if…", "add a…").
 */

/** Words that name a part of the app (whole words / phrases, lower case). */
const APP_TERMS = [
  "app", "ipad", "tablet", "screen", "button", "page", "tab", "pop-up", "popup", "pop up",
  "notification", "dashboard", "planner", "system", "menu", "drop-down", "dropdown", "drop down",
  "field", "login", "log in", "sign in", "pin", "to-do", "todo", "filter", "search bar",
  "display", "settings", "setting", "alert", "sync", "shopify", "planday",
  "tick box", "checkbox", "tap", "click", "swipe", "scroll", "website", "online", "spreadsheet",
  "station screen", "pack report", "auto", "automatically",
] as const;

/** Ways people ask for a change. */
const ASK_PHRASES = [
  "could we", "can we", "could it", "can it", "could the", "can the", "could you", "can you",
  "would be good if", "would be great if", "would be nice if", "would be helpful if", "would help if", "it would help",
  "should show", "should display", "should have", "should let", "should be able", "be able to",
  "add a", "add an", "option to", "ability to", "allow us", "make it", "i wish", "we need the",
  "is there a way", "please",
] as const;

/** Stations that mean "the app itself" when an idea is logged against them. */
const APP_STATIONS = ["app / ipad", "app", "ipad", "system"];

function hits(text: string, list: readonly string[]): string[] {
  const found: string[] = [];
  for (const term of list) {
    const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&").replace(/ /g, "\\s+")}($|[^a-z0-9])`, "i");
    if (re.test(text) && !found.includes(term)) found.push(term);
  }
  return found;
}

export type AppRequestVerdict = { flagged: boolean; reasons: string[] };

export function looksLikeAppRequest(idea: { title: string; description?: string | null; station?: string | null }): AppRequestVerdict {
  const text = `${idea.title ?? ""}\n${idea.description ?? ""}`.toLowerCase();
  const station = (idea.station ?? "").trim().toLowerCase();
  const reasons: string[] = [];

  const onApp = APP_STATIONS.includes(station);
  if (onApp) reasons.push("Logged against the app");
  const terms = hits(text, APP_TERMS);
  if (terms.length) reasons.push(`Mentions ${terms.slice(0, 4).map(t => `"${t}"`).join(", ")}`);
  const asks = hits(text, ASK_PHRASES);
  if (asks.length) reasons.push(`Asks for a change ("${asks[0]}")`);

  const flagged = onApp || terms.length >= 2 || (terms.length >= 1 && asks.length >= 1);
  return { flagged, reasons: flagged ? reasons : [] };
}

/** Which ideas get checked: open ones (not finished or turned down), not
 *  already joined to an issue, logged in the last `days` days. */
export function ideaWantsScan(i: { progressStatus: string; createdAt: Date | string; linkedToIssue: boolean }, now: Date, days = 30): boolean {
  if (i.linkedToIssue) return false;
  if (i.progressStatus === "complete" || i.progressStatus === "rejected") return false;
  return now.getTime() - new Date(i.createdAt).getTime() <= days * 24 * 60 * 60 * 1000;
}

export const SUGGESTION_STATUSES = ["suggested", "added", "dismissed"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** Graeme's choices on a suggestion: add or dismiss while suggested;
 *  restore a dismissed one. Added is final (it's an app issue now). */
export function suggestionMove(from: string, action: "add" | "dismiss" | "restore"): SuggestionStatus | null {
  if (action === "add" && from === "suggested") return "added";
  if (action === "dismiss" && from === "suggested") return "dismissed";
  if (action === "restore" && from === "dismissed") return "suggested";
  return null;
}

/** The app issue an added idea becomes — in the idea's own words. */
export function issueTextFromIdea(i: { id: number; title: string; description?: string | null }): string {
  const desc = (i.description ?? "").trim();
  return desc && desc !== i.title.trim() ? `${i.title.trim()}\n\n${desc}` : i.title.trim();
}
