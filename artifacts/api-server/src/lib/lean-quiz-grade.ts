/**
 * Marking a lean quiz — one rule for the team's weekly review and the
 * founder's review-ahead preview (Graeme, 2026-10-01: "I want to have to
 * answer the questions and get them right during the preview"). Full marks
 * passes; anything less is "not yet", retries free. Pure.
 */
export function gradeQuiz(quiz: Array<{ answer: number }>, answers: number[]): { passed: boolean; correct: number; total: number } {
  const total = quiz.length;
  const correct = quiz.filter((q, i) => answers[i] === q.answer).length;
  const passed = total === 0 || (answers.length === total && correct === total);
  return { passed, correct, total };
}
