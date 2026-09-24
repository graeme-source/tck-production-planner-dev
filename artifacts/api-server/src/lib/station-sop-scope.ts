/**
 * Which station screens an attached SOP shows on (Graeme, 2026-09-24).
 *
 * A station's training matrix (and its review gate) covers EVERY SOP a
 * person working that station can see on it — not only the SOPs pinned to
 * the station's front screen. SOPs attach to many things; each kind shows on
 * particular station screens:
 *   station            → that station
 *   checklist_template → that checklist's station
 *   recipe             → Raw Meat (meat recipes), Mixing, Building 1 & 2,
 *                        Wrapping (calzones) / Wrapping (mac cheese lines)
 *   recipe_ingredient,
 *   ingredient         → Raw Meat (raw meats), Main Prep + Bases & Sauces
 *   sub_recipe         → Bases & Sauces
 *   page               → no station (it's a page, not a station)
 * A link attached on one screen carries that screen as target_text and
 * counts only there ("building" = both building tables); target_text NULL
 * means "wherever this recipe/ingredient appears".
 *
 * Mirrors which screens call /links/for-recipes, /for-ingredients,
 * /for-sub-recipes and /for-checklist (and with which station name) — keep
 * the two in step.
 */
export interface SopLinkRow {
  targetType: string;
  targetA: number | null;
  targetB: number | null;
  targetText: string | null;
}

export interface SopScopeFacts {
  /** Recipe uses raw meat (directly or through a sub-recipe). */
  recipeHasRawMeat(recipeId: number): boolean;
  recipeIsMacCheese(recipeId: number): boolean;
  ingredientIsRawMeat(ingredientId: number): boolean;
  checklistStation(templateId: number): string | null;
}

/** A screen name as used by the SOP link endpoints → station keys. */
export function expandSurface(surface: string): string[] {
  return surface === "building" ? ["building_1", "building_2"] : [surface];
}

export function stationsForLink(link: SopLinkRow, facts: SopScopeFacts): string[] {
  const surface = link.targetText?.trim() || null;
  switch (link.targetType) {
    case "station":
      return surface ? [surface] : [];
    case "checklist_template": {
      const st = link.targetA != null ? facts.checklistStation(link.targetA) : null;
      return st ? [st] : [];
    }
    case "recipe": {
      if (surface) return expandSurface(surface);
      if (link.targetA == null) return [];
      const out: string[] = [];
      if (facts.recipeHasRawMeat(link.targetA)) out.push("prep_meat");
      if (facts.recipeIsMacCheese(link.targetA)) out.push("wrapping");
      else out.push("mixing", "building_1", "building_2", "wrapping");
      return out;
    }
    case "recipe_ingredient":
    case "ingredient": {
      if (surface) return expandSurface(surface);
      const ingredientId = link.targetType === "recipe_ingredient" ? link.targetB : link.targetA;
      if (ingredientId == null) return [];
      return facts.ingredientIsRawMeat(ingredientId) ? ["prep_meat"] : ["main_prep", "prep_bases"];
    }
    case "sub_recipe":
      return surface ? expandSurface(surface) : ["prep_bases"];
    default:
      return [];
  }
}
