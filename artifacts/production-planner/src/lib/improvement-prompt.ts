/**
 * "Have you made an improvement today?" — the optional last item on every
 * closing checklist (Graeme, 27 Oct 2026; Objectives E and H). The server
 * owns the rules (api-server lib/checklist-optional.ts); this is the type
 * id the screen switches on, and the words.
 */
export const IMPROVEMENT_PROMPT_TYPE = "improvement_prompt";

/** How the item reads in the checklist editor. */
export const IMPROVEMENT_PROMPT_ADMIN_LABEL = "Improvement question (optional)";

export const PROMPT_COPY = {
  question: "Have you made an improvement today?",
  optional: "Optional — it never holds up your checklist.",
  yesDone: "Thanks — improvement logged ✓",
  noDone: "No problem — tomorrow's another chance 👍",
} as const;

export interface PromptToday {
  day: string;
  answer: null | {
    answer: "yes" | "no";
    improvementId: number | null;
    improvementTitle: string | null;
    answeredAt: string;
  };
  loggedToday: Array<{ id: number; title: string }>;
}
