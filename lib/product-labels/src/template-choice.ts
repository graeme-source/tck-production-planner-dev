/**
 * Which label template a recipe uses (pure, tested). Objective D.
 *
 *   1. the one picked in its label settings (product_label_settings.template_id);
 *   2. else the first template (lowest id) whose `defaultForCategories`
 *      lists the recipe's category — so a new macaroni cheese gets the
 *      Macaroni cheese label without anyone remembering to pick it;
 *   3. else the standard template (null = lowest id, as before).
 *
 * No product or category name is written here: the categories live on each
 * template and are edited in Label design.
 */

export interface TemplateCategoryDefaults {
  id: number;
  name: string;
  defaultForCategories: string[];
}

export type TemplateChoiceReason = "chosen" | "category" | "standard";

export interface TemplateChoice {
  /** The template to load; null = the standard one. */
  id: number | null;
  reason: TemplateChoiceReason;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The template a recipe in `category` gets when it hasn't picked one. */
export function categoryDefaultTemplate(category: string | null | undefined, templates: TemplateCategoryDefaults[]): TemplateCategoryDefaults | null {
  const c = category ? norm(category) : "";
  if (!c) return null;
  return [...templates].sort((a, b) => a.id - b.id).find(t => t.defaultForCategories.some(x => norm(x) === c)) ?? null;
}

export function resolveTemplateChoice(
  chosenId: number | null | undefined,
  category: string | null | undefined,
  templates: TemplateCategoryDefaults[],
): TemplateChoice {
  // A picked id that no longer exists falls through to the category (the FK
  // is ON DELETE SET NULL, so this is belt and braces).
  if (chosenId != null && templates.some(t => t.id === chosenId)) return { id: chosenId, reason: "chosen" };
  const byCategory = categoryDefaultTemplate(category, templates);
  if (byCategory) return { id: byCategory.id, reason: "category" };
  return { id: null, reason: "standard" };
}
