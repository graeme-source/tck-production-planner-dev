/**
 * What the main button on a weekly lean lesson page does. Pure, tested.
 *
 * A week with no quiz used to dead-end (Graeme, 9 Nov 2026): Next on the last
 * page went nowhere and the week could never be finished, so the reminder sat
 * on the dashboard all week. Now the last page finishes it.
 */
export type PagerAction = "next" | "quiz" | "finish" | "none";

export function pagerAction(input: { pageIdx: number; lessonCount: number; hasQuiz: boolean; done: boolean }): PagerAction {
  const { pageIdx, lessonCount, hasQuiz, done } = input;
  if (hasQuiz) {
    if (pageIdx >= lessonCount) return "none"; // on the quiz page: its own button
    return pageIdx === lessonCount - 1 ? "quiz" : "next";
  }
  if (pageIdx < lessonCount - 1) return "next";
  return done ? "none" : "finish";
}
