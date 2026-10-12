/**
 * What the recipe and sub-recipe editors send to the server, built in one
 * place so the shared editor (components/recipe-editor) can't drift from the
 * endpoints' shapes. Pure — tested against the exact bodies the editors sent
 * before they were merged (recipe-editor-payload.test.ts).
 *
 *   Final products: POST /api/recipes, PUT /api/recipes/:id; isFridgeProduct
 *   rides PUT /api/recipes/:id/fridge-product (the generated body validator
 *   would drop it). QUID ticks are owned by the QUID panel, never sent here.
 *   Sub-recipes: POST /api/sub-recipes, PUT /api/sub-recipes/:id — the form
 *   values as they are (the server reads the nested rows with rawBody()).
 */
import { withoutQuid } from "../components/recipe-quid/api";

type Line = Record<string, unknown>;

/** The recipe form's values the payload depends on. */
export type RecipeFormValuesForPayload = {
  targetBuildMinutes?: number | null;
  isFridgeProduct?: boolean;
  ovenTimeMinutes?: number | null;
  ovenTempC?: number | null;
  startAsDraft?: boolean;
  isCoreMenu?: boolean;
  isCurrentSpecial?: boolean;
  ingredients: Line[];
  subRecipes: Line[];
  [key: string]: unknown;
};

function common<T extends RecipeFormValuesForPayload>(data: T) {
  const { targetBuildMinutes, isFridgeProduct, ovenTimeMinutes, startAsDraft, ...rest } = data;
  return {
    rest,
    startAsDraft,
    isFridgeProduct: isFridgeProduct === true,
    timing: {
      targetBuildSeconds: targetBuildMinutes != null ? Math.round(targetBuildMinutes * 60) : null,
      ovenTempC: rest.ovenTempC ?? null,
      ovenTimeSeconds: ovenTimeMinutes != null ? Math.round(ovenTimeMinutes * 60) : null,
    },
  };
}

/** PUT /api/recipes/:id. `isDraft` = the recipe is currently a draft: ticking
 *  Core menu / Special on a draft publishes it (migration 0142). */
export function buildRecipeUpdatePayload<T extends RecipeFormValuesForPayload>(data: T, opts: { isDraft: boolean }) {
  const { rest, isFridgeProduct, timing } = common(data);
  const publishDraft = opts.isDraft && (rest.isCoreMenu === true || rest.isCurrentSpecial === true);
  const body = {
    ...withoutQuid(rest),
    ...(publishDraft ? { publishDraft: true } : {}),
    ...timing,
  };
  return { body, isFridgeProduct };
}

/** POST /api/recipes. Starts as a draft only when asked and neither Core
 *  menu nor Special is ticked. */
export function buildRecipeCreatePayload<T extends RecipeFormValuesForPayload>(data: T) {
  const { rest, startAsDraft, isFridgeProduct, timing } = common(data);
  const isDraft = startAsDraft === true && rest.isCoreMenu !== true && rest.isCurrentSpecial !== true;
  const body = {
    ...withoutQuid(rest),
    isDraft,
    ...timing,
  };
  return { body, isDraft, isFridgeProduct };
}

/** POST / PUT /api/sub-recipes — the validated form values, unchanged. */
export function buildSubRecipePayload<T extends Record<string, unknown>>(data: T): T {
  return data;
}
