/**
 * Forced testing — the pure rules (Graeme, 2026-10-10; Objectives E and F).
 * Routes: routes/test-requests.ts (people) and
 * routes/test-requests-machine.ts (the deploy session). Tested in
 * test-request-rules.test.ts.
 *
 * WHO tests: if the request came from an issue report or an improvement
 * idea, the person who reported / submitted it is ALWAYS asked ("always the
 * person who reported it in the first instance"); anyone else chosen is
 * asked as well. Otherwise (or if their account is gone) someone must be
 * chosen.
 *
 * NO NAGGING (round 2): there is no snooze timer. The card shows once — or,
 * for a test tied to a place, each time the tester arrives there — and
 * "I'll do it later" puts it on their to-do list, after which it never pops
 * up again (production-planner lib/test-requests.ts decides when).
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

/** The to-do a tester's "I'll do it later" puts on their own list. Opening
 *  its link brings the card back with "Take me there". */
export function testTodoTitle(title: string): string {
  const t = `Test: ${title}`;
  return t.length > 300 ? `${t.slice(0, 299)}…` : t;
}

export function testTodoUrl(requestId: number): string {
  return `/?testRequest=${requestId}`;
}

export const ANSWER_LABELS: Record<TestAnswer, string> = {
  works_easy: "Works and easy to understand",
  works_confusing: "Works but confusing",
  doesnt_work: "Doesn't work",
  cant_test: "Couldn't test it",
};

export type TesterPick = { userId: number; isReporter: boolean };

/**
 * Who must test it. `originIds` are the people the request came from — the
 * originating issue's reporter and/or the improvement idea's submitter (the
 * lead name, not every multi-credited person) — and they are ALWAYS asked
 * (isReporter). Anyone else chosen is asked as well.
 */
export function testersFor(opts: {
  originIds: ReadonlyArray<number | null | undefined>;
  chosenIds: readonly number[];
}): { ok: true; testers: TesterPick[] } | { ok: false; error: string } {
  const out: TesterPick[] = [];
  for (const id of opts.originIds) {
    if (id != null && !out.some(t => t.userId === id)) out.push({ userId: id, isReporter: true });
  }
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

/**
 * What happens to a tester's linked to-do: answering ticks it off; closing
 * the request removes it while it's still open (a done one stays as
 * history). Nothing to do without a to-do, or once it's already done.
 */
export function todoPlan(event: "answered" | "closed", todo: { status: string } | null): "tick" | "delete" | "none" {
  if (!todo || todo.status !== "open") return "none";
  return event === "answered" ? "tick" : "delete";
}
