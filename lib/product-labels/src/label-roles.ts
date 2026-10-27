/**
 * A recipe's labels, by role (pure, tested). Objective D.
 *
 * Most recipes have ONE label: the back label, printed at wrapping and
 * going out on the pack ("main" — every label version published before
 * roles existed is this one).
 *
 * A recipe may also have a WRAPPING label (Graeme, 2026-10-27, cinnamon
 * buns): a small internal freezer label the wrapping station prints instead
 * — name, 180-day use-by, batch — and then, on the despatch morning, the
 * main label (for the buns, the big "despatch" label with the short use-by)
 * goes over the top, printed from the dessert report.
 *
 *   main      the template picked in the label settings (template-choice.ts);
 *             printed at wrapping unless there is a wrapping label.
 *   wrapping  optional: product_label_settings.wrapping_template_id. Only
 *             ever picked by hand — no category default.
 *
 * Each role is published and live-versioned on its own
 * (product_label_versions.role).
 */

export type LabelRole = "main" | "wrapping";
export const LABEL_ROLES: LabelRole[] = ["main", "wrapping"];

export function normaliseLabelRole(v: unknown): LabelRole {
  return v === "wrapping" ? "wrapping" : "main";
}

/** The wrapping label's template, or null = the recipe has none (the
 *  wrapping station prints the main label). A picked id that no longer
 *  exists counts as none. */
export function wrappingTemplateChoice(wrappingTemplateId: number | null | undefined, templateIds: number[]): number | null {
  return wrappingTemplateId != null && templateIds.includes(wrappingTemplateId) ? wrappingTemplateId : null;
}

/** Which label the wrapping station prints for a recipe. */
export function wrappingStationRole(hasWrappingLabel: boolean): LabelRole {
  return hasWrappingLabel ? "wrapping" : "main";
}

/** What people call each label. With a wrapping label, the main one is the
 *  despatch label (it goes on as the product leaves); without, it is just
 *  the back label, as it always was. */
export function labelRoleTitle(role: LabelRole, hasWrappingLabel: boolean): string {
  if (role === "wrapping") return "Wrapping label";
  return hasWrappingLabel ? "Despatch label" : "Back label";
}
