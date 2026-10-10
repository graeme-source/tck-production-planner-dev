/**
 * Forced testing — the pure rules (Graeme, 2026-10-10; Objectives E and F).
 * Routes: routes/test-requests.ts (people) and
 * routes/test-requests-machine.ts (the deploy session). Tested in
 * test-request-rules.test.ts.
 *
 * WHO tests: if the request came from an issue report, the person who
 * reported it is ALWAYS asked ("always the person who reported it in the
 * first instance"); anyone else chosen is asked as well. Without an issue
 * (or if the reporter's account is gone), someone must be chosen.
 *
 * STATUS, worked out from the testers' rows, never stored:
 *   closed       a manager closed it (whatever the answers)
 *   problems     anyone said "Works but confusing" or "Doesn't work"
 *   passed       everyone has answered and at least one said it works
 *   skipped      everyone has answered "I can't test this"
 *   in_progress  someone has started (tapped "Take me there") or answered
 *   waiting      nobody has touched it yet
 */
import { validateTestPath } from "./issue-pipeline-rules";

export const TEST_ANSWERS = ["works_easy", "works_confusing", "doesnt_work", "cant_test"] as const;
export type TestAnswer = (typeof TEST_ANSWERS)[number];

export const TEST_STATUSES = ["waiting", "in_progress", "passed", "problems", "skipped", "closed"] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export const ANSWER_LABELS: Record<TestAnswer, string> = {
  works_easy: "Works and easy to understand",
  works_confusing: "Works but confusing",
  doesnt_work: "Doesn't work",
  cant_test: "Couldn't test it",
};

/** How long "Not now" puts the card away (it also comes back on another
 *  person's sign-in, because it is per person). */
export const SNOOZE_MINUTES = 120;

export type TesterPick = { userId: number; isReporter: boolean };

export function testersFor(opts: {
  /** The originating issue's reporter, if there is an issue and they still have an account. */
  reporterId: number | null;
  chosenIds: readonly number[];
}): { ok: true; testers: TesterPick[] } | { ok: false; error: string } {
  const out: TesterPick[] = [];
  if (opts.reporterId != null) out.push({ userId: opts.reporterId, isReporter: true });
  for (const id of opts.chosenIds) {
    if (!Number.isInteger(id) || id <= 0) continue;
    if (out.some(t => t.userId === id)) continue;
    out.push({ userId: id, isReporter: false });
  }
  if (out.length === 0) return { ok: false, error: "Choose who should test it" };
  return { ok: true, testers: out };
}

export type TesterState = { answer: string | null; startedAt: Date | string | null };

export function requestStatus(r: { closedAt: Date | string | null; testers: readonly TesterState[] }): TestStatus {
  if (r.closedAt) return "closed";
  const answers = r.testers.map(t => t.answer).filter((a): a is string => !!a);
  if (answers.some(a => a === "works_confusing" || a === "doesnt_work")) return "problems";
  const allAnswered = r.testers.length > 0 && answers.length === r.testers.length;
  if (allAnswered) return answers.some(a => a === "works_easy") ? "passed" : "skipped";
  if (answers.length > 0 || r.testers.some(t => t.startedAt)) return "in_progress";
  return "waiting";
}

/** Is this request still asking this person? Open, assigned, unanswered. */
export function stillAsking(r: { closedAt: Date | string | null }, t: { answer: string | null } | null): boolean {
  return !r.closedAt && !!t && !t.answer;
}

export type AnswerVerdict = { ok: true } | { ok: false; status: 403 | 404 | 409; error: string };

export function answerVerdict(r: { closedAt: Date | string | null } | null, t: { answer: string | null } | null): AnswerVerdict {
  if (!r) return { ok: false, status: 404, error: "Test request not found" };
  if (!t) return { ok: false, status: 403, error: "This test isn't assigned to you" };
  if (r.closedAt) return { ok: false, status: 409, error: "This test has been closed — no answer needed" };
  if (t.answer) return { ok: false, status: 409, error: "You've already answered this one" };
  return { ok: true };
}

/** A "can't test it" must say why, so the asker can sort it. */
export function answerNoteProblem(answer: TestAnswer, note: string | null | undefined): string | null {
  if (answer === "cant_test" && !(note ?? "").trim()) return "Say why you can't test it, so it can be sorted";
  return null;
}

/** Answers the person who asked must hear about straight away. */
export function answerNeedsFollowUp(answer: TestAnswer): boolean {
  return answer !== "works_easy";
}

export function snoozeUntil(now: Date): Date {
  return new Date(now.getTime() + SNOOZE_MINUTES * 60_000);
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isHhMm(s: string | null | undefined): boolean {
  return !!s && HHMM.test(s);
}

/** "Only on pages like…": an in-app path where "*" stands for one part,
 *  e.g. /plans/STAR/station/building (written with a real star). */
export function validatePathPattern(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  // Stars are allowed only as whole parts; check the rest like a link.
  const p = raw.trim();
  if (p.split("/").some(seg => seg.includes("*") && seg !== "*")) return null;
  return validateTestPath(p.replace(/\*/g, "x")) ? p : null;
}

/** The text that goes on the issue's thread when a tester answers. */
export function issueCommentFor(testerName: string, title: string, answer: TestAnswer, note: string | null | undefined): string {
  const n = (note ?? "").trim();
  return `Test result from ${testerName} — "${title}": ${ANSWER_LABELS[answer]}.${n ? `\n${n}` : ""}`;
}

/** The bell message for whoever asked, when an answer needs following up. */
export function followUpMessage(testerName: string, title: string, answer: TestAnswer): string {
  return `${testerName} tested "${title}": ${ANSWER_LABELS[answer]}`;
}
