import type { SurveyQuestion } from "@workspace/db";

export const SURVEY_TEXT_MAX_CHARS = 2000;

export function questionOptions(q: SurveyQuestion): string[] {
  return Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === "string") : [];
}

/**
 * Validate one submitted answer value against its question. Returns an error
 * message, or null when the value is valid. Value shapes:
 *   rating -> integer 1..max, slider -> number 0..100,
 *   choice -> one option string, multi -> option string[],
 *   text -> string (<=2000 chars),
 *   rank -> string[] that is exactly the option list in ranked order.
 */
export function validateAnswerValue(q: SurveyQuestion, value: unknown): string | null {
  switch (q.type) {
    case "rating": {
      if (typeof value !== "number" || !Number.isInteger(value)) return "rating must be a whole number";
      if (value < 1 || value > q.max) return `rating must be between 1 and ${q.max}`;
      return null;
    }
    case "slider": {
      // 0-100 approval percentage from the widget's slider. Not clamped to
      // q.max — the scale is fixed by the type, not the builder.
      if (typeof value !== "number" || !Number.isFinite(value)) return "slider must be a number";
      if (value < 0 || value > 100) return "slider must be between 0 and 100";
      return null;
    }
    case "choice": {
      if (typeof value !== "string") return "choice must be a string";
      if (!questionOptions(q).includes(value)) return "choice is not one of the options";
      return null;
    }
    case "multi": {
      if (!Array.isArray(value) || value.some(v => typeof v !== "string")) return "multi must be an array of strings";
      const options = questionOptions(q);
      if (value.some(v => !options.includes(v))) return "multi contains an unknown option";
      if (new Set(value).size !== value.length) return "multi contains duplicate options";
      if (q.required && value.length === 0) return "at least one option is required";
      return null;
    }
    case "text": {
      if (typeof value !== "string") return "text must be a string";
      if (value.length > SURVEY_TEXT_MAX_CHARS) return `text is too long (max ${SURVEY_TEXT_MAX_CHARS} characters)`;
      if (q.required && value.trim().length === 0) return "an answer is required";
      return null;
    }
    case "rank": {
      if (!Array.isArray(value) || value.some(v => typeof v !== "string")) return "rank must be an array of strings";
      const options = questionOptions(q);
      // A ranking must mention every option exactly once — a partial or padded
      // list would silently skew the average-position aggregate.
      if (value.length !== options.length || new Set(value).size !== value.length ||
          value.some(v => !options.includes(v))) {
        return "rank must contain every option exactly once";
      }
      return null;
    }
    default:
      return "unknown question type";
  }
}
