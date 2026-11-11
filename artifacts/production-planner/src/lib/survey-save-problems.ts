/**
 * What stops a survey from saving, in plain words, so the builder can say
 * why instead of silently greying out Save. (Graeme, 11 Nov: "every time I
 * add a new question, it greys out the Save Survey button" — a new question
 * starts blank, and a blank question can't be saved.)
 */

export type SaveProblemQuestion = {
  key: string;
  type: string;
  prompt: string;
  options: string[];
};

export type SaveProblem = {
  /** The question at fault, or null for the survey itself. */
  questionKey: string | null;
  /** Short, shown on the question card. */
  message: string;
  /** Full, shown by Save: names the question by number. */
  summary: string;
};

export const SURVEY_OPTION_TYPES = ["choice", "multi", "rank"];

export function surveySaveProblems(form: {
  title: string;
  questions: SaveProblemQuestion[];
  finalPageProblems?: string[];
}): SaveProblem[] {
  const problems: SaveProblem[] = [];
  if (form.title.trim() === "") {
    problems.push({ questionKey: null, message: "Give the survey a title", summary: "Give the survey a title" });
  }
  if (form.questions.length === 0) {
    problems.push({ questionKey: null, message: "Add at least one question", summary: "Add at least one question" });
  }
  form.questions.forEach((q, i) => {
    const n = i + 1;
    if (q.prompt.trim() === "") {
      problems.push({
        questionKey: q.key,
        message: "Type the question, or pick a recipe to fill it in",
        summary: `Question ${n} has no wording yet`,
      });
    }
    if (SURVEY_OPTION_TYPES.includes(q.type) && q.options.map(o => o.trim()).filter(Boolean).length < 2) {
      problems.push({
        questionKey: q.key,
        message: "Needs at least 2 options",
        summary: `Question ${n} needs at least 2 options`,
      });
    }
  });
  for (const p of form.finalPageProblems ?? []) {
    problems.push({ questionKey: null, message: p, summary: `Final page: ${p}` });
  }
  return problems;
}
