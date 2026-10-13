// Where the tin size shows on the prep screens (Main Prep, Bases & Sauces).
//
// The tin size belongs to the RECIPE (the tin the finished mix goes into),
// not to each ingredient. Printing "Tin 1 (XXL)" on every ingredient tile
// read as "put this ingredient in its own XXL tin" — a new colleague did
// exactly that (fix-queue #323, Graeme 13 Oct 2026). So the tin size now
// shows once, next to the recipe name in the left-hand "Ingredients by
// Recipe" list, and the per-ingredient tiles just say "Tin 1", "Tin 2"…

/** "Balsamic Roasted Vegetables" + "XL" → "Balsamic Roasted Vegetables (XL)".
 *  No tin size set (null / blank) → just the name. */
export function recipeNameWithTinSize(recipeName: string, tinSize: string | null | undefined): string {
  const size = (tinSize ?? "").trim();
  return size ? `${recipeName} (${size})` : recipeName;
}

/** Label on an ingredient's tin tile. Deliberately carries no tin size —
 *  see the note at the top of this file. */
export function prepTinTileLabel(tinNumber: number): string {
  return `Tin ${tinNumber}`;
}
