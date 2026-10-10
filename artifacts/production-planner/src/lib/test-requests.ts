/**
 * Forced testing — when the "Can you test this?" card shows, and the words
 * on it (Graeme, 2026-10-10; Objectives E and F). Pure; tested in
 * test-requests.test.ts. The server decides WHO (api-server
 * lib/test-request-rules.ts); this decides WHEN, on this screen, now.
 *
 * A request is DUE when every condition it has is met:
 *   not before   now is at or after that moment
 *   between      London time of day is inside the window (an "until"
 *                earlier than "from" runs overnight, e.g. 22:00–06:00)
 *   only on page the current page matches the pattern ("*" = any one part,
 *                so /plans/STAR/station/building is "next time you build")
 * Once the tester has STARTED it ("Take me there"), it follows them to any
 * page — they're in the middle of testing — but the time conditions don't
 * matter any more either: they already met them.
 *
 * The card shows the first due request that isn't put off ("Not now"),
 * started ones first — and never over the PIN pad, another must-answer
 * prompt or any full-screen pop-up, and never on the kiosk / meeting /
 * scan / print pages.
 */
import { promptHiddenOnPath } from "./emergency-contacts";

export type TestAnswer = "works_easy" | "works_confusing" | "doesnt_work" | "cant_test";
export type TestStatus = "waiting" | "in_progress" | "passed" | "problems" | "skipped" | "closed";

export type MyTestRequest = {
  id: number;
  title: string;
  steps: string;
  linkPath: string | null;
  onlyOnPath: string | null;
  notBefore: string | null;
  dailyFrom: string | null;
  dailyUntil: string | null;
  whenText: string | null;
  createdByName: string;
  andonIssueId: number | null;
  issueDescription: string | null;
  isReporter: boolean;
  startedAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
};

export const ANSWER_OPTIONS: Array<{ answer: Exclude<TestAnswer, "cant_test">; label: string; hint: string; tone: string }> = [
  { answer: "works_easy", label: "Works and easy to understand", hint: "All good", tone: "bg-emerald-600 text-white" },
  { answer: "works_confusing", label: "Works but confusing", hint: "It did it, but it wasn't clear", tone: "bg-amber-500 text-white" },
  { answer: "doesnt_work", label: "Doesn't work", hint: "Something went wrong", tone: "bg-rose-600 text-white" },
];

export const ANSWER_LABELS: Record<TestAnswer, string> = {
  works_easy: "Works and easy to understand",
  works_confusing: "Works but confusing",
  doesnt_work: "Doesn't work",
  cant_test: "Couldn't test it",
};

export const STATUS_LABELS: Record<TestStatus, string> = {
  waiting: "Waiting",
  in_progress: "In progress",
  passed: "Passed",
  problems: "Problems found",
  skipped: "Skipped",
  closed: "Closed",
};

function segments(path: string): string[] {
  return path.split(/[?#]/)[0]!.split("/").filter(Boolean);
}

/** Does this page match the pattern? "*" is any one part of the path. */
export function pathMatches(pattern: string, path: string): boolean {
  const p = segments(pattern);
  const a = segments(path);
  if (p.length !== a.length) return false;
  return p.every((seg, i) => seg === "*" || seg.toLowerCase() === a[i]!.toLowerCase());
}

const LONDON_HM = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function londonMinuteOfDay(now: Date): number {
  const [h, m] = LONDON_HM.format(now).split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function hhmm(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function inDailyWindow(from: string | null, until: string | null, now: Date): boolean {
  const f = hhmm(from), u = hhmm(until);
  if (f == null && u == null) return true;
  const t = londonMinuteOfDay(now);
  if (f != null && u == null) return t >= f;
  if (f == null && u != null) return t < u;
  if (f! <= u!) return t >= f! && t < u!;
  return t >= f! || t < u!; // overnight
}

export function isDue(r: Pick<MyTestRequest, "notBefore" | "dailyFrom" | "dailyUntil" | "onlyOnPath" | "startedAt">, now: Date, path: string): boolean {
  if (r.startedAt) return true;
  if (r.notBefore && now.getTime() < new Date(r.notBefore).getTime()) return false;
  if (!inDailyWindow(r.dailyFrom, r.dailyUntil, now)) return false;
  if (r.onlyOnPath && !pathMatches(r.onlyOnPath, path)) return false;
  return true;
}

export function isSnoozed(r: Pick<MyTestRequest, "snoozedUntil">, now: Date): boolean {
  return !!r.snoozedUntil && new Date(r.snoozedUntil).getTime() > now.getTime();
}

/** The one request to ask about now, or null. */
export function pickTestToShow<T extends MyTestRequest>(list: readonly T[] | undefined, now: Date, path: string): T | null {
  if (!list) return null;
  const live = list.filter(r => !isSnoozed(r, now) && isDue(r, now, path));
  return live.find(r => r.startedAt) ?? live[0] ?? null;
}

export function shouldShowTestCard(f: {
  request: MyTestRequest | null;
  pinLocked: boolean;
  otherPromptShowing: boolean;
  path: string;
}): boolean {
  if (!f.request || f.pinLocked || f.otherPromptShowing) return false;
  return !promptHiddenOnPath(f.path);
}

/** Is the tester already on the page "Take me there" goes to? */
export function onLinkedPage(linkPath: string | null, path: string): boolean {
  if (!linkPath) return false;
  return pathMatches(linkPath, path);
}

const DATE_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "When" in plain words, for the card and the list. */
export function whenSummary(r: Pick<MyTestRequest, "whenText" | "notBefore" | "dailyFrom" | "dailyUntil" | "onlyOnPath">): string {
  if (r.whenText?.trim()) return r.whenText.trim();
  const parts: string[] = [];
  if (r.notBefore) parts.push(`from ${DATE_TIME.format(new Date(r.notBefore))}`);
  if (r.dailyFrom && r.dailyUntil) parts.push(`between ${r.dailyFrom} and ${r.dailyUntil}`);
  else if (r.dailyFrom) parts.push(`after ${r.dailyFrom}`);
  else if (r.dailyUntil) parts.push(`before ${r.dailyUntil}`);
  if (r.onlyOnPath) parts.push(`on ${r.onlyOnPath.replace(/\/\*\//g, "/…/")}`);
  return parts.length ? parts.join(", ") : "Any time";
}

/** Who will be asked, for the form: the issue's reporter first, always. */
export function testerPreview(reporter: { id: number; name: string } | null, chosen: ReadonlyArray<{ id: number; name: string }>): Array<{ id: number; name: string; isReporter: boolean }> {
  const out: Array<{ id: number; name: string; isReporter: boolean }> = [];
  if (reporter) out.push({ ...reporter, isReporter: true });
  for (const c of chosen) if (!out.some(o => o.id === c.id)) out.push({ ...c, isReporter: false });
  return out;
}

/** A "can't test it" must say why. */
export function answerReady(answer: TestAnswer | null, note: string): boolean {
  if (!answer) return false;
  return answer !== "cant_test" || note.trim().length > 0;
}
