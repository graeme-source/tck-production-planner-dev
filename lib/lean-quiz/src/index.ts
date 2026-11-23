/**
 * A Lean week's end-of-week quiz, as edited by hand on the Lean curriculum
 * week screen (Graeme, 23 Nov 2026: "I can't edit the questions in the
 * quiz"). Shared by the server (which saves it) and the screen (which only
 * sends a quiz that will save), so both agree what a valid quiz is.
 *
 * Stored as JSON on lean_principles.quiz_json: [{question, options, answer}],
 * `answer` = index of the right option. The review flow marks a pass when
 * every answer matches.
 */
export interface QuizQuestion { question: string; options: string[]; answer: number }

export const MAX_QUESTIONS = 20; // the review flow accepts up to 20 answers
export const MAX_OPTIONS = 6;

export type QuizCheck = { ok: true; quiz: QuizQuestion[] } | { ok: false; problem: string };

/** Tidy a quiz being edited and say whether it can be saved: text trimmed,
 *  blank answer options dropped (the right-answer mark moves with its
 *  option), every question needing a question, two or more answers and a
 *  right answer. */
export function checkQuiz(input: QuizQuestion[]): QuizCheck {
  if (input.length === 0) return { ok: false, problem: "Add at least one question" };
  if (input.length > MAX_QUESTIONS) return { ok: false, problem: `No more than ${MAX_QUESTIONS} questions` };
  const quiz: QuizQuestion[] = [];
  for (let i = 0; i < input.length; i++) {
    const q = input[i];
    const n = i + 1;
    const question = q.question.trim();
    if (!question) return { ok: false, problem: `Question ${n} needs its question` };
    let answer = -1;
    const options: string[] = [];
    q.options.forEach((raw, oi) => {
      const text = raw.trim();
      if (!text) return;
      if (oi === q.answer) answer = options.length;
      options.push(text);
    });
    if (options.length < 2) return { ok: false, problem: `Question ${n} needs at least two answers` };
    if (options.length > MAX_OPTIONS) return { ok: false, problem: `Question ${n} can have up to ${MAX_OPTIONS} answers` };
    if (answer < 0) return { ok: false, problem: `Question ${n}: tick the right answer` };
    quiz.push({ question, options, answer });
  }
  return { ok: true, quiz };
}
