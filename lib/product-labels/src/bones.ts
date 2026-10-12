/**
 * The bones warning ("Whilst every effort has been made to remove all
 * bones…"): on, off, or — the default — worked out from the ingredients
 * (Graeme, 2026-10-12: "anything with chicken in it… by default, tick the
 * bones warning… I'm scared I'm going to forget to turn it off").
 *
 * The trigger words are template data (LabelTemplate.boneRiskWords, default
 * ["chicken"]), never names in code. A word matches as a whole word,
 * ignoring case, anywhere in the recipe's full flattened deck — sub-recipes
 * included — so "chicken" finds "Chicken Thigh" and "chicken stock" but not
 * "chickpea". Pure and tested.
 */

/** Per-recipe setting: true / false = always on / off; null = automatic. */
export type BonesSetting = boolean | null;

export interface BoneRiskMatch {
  /** The trigger word that matched, as configured. */
  word: string;
  /** The ingredient it was found in, e.g. "Chicken Thigh". */
  ingredient: string;
}

export interface BonesWarning {
  /** What prints. */
  on: boolean;
  mode: "auto" | "on" | "off";
  /** What Automatic finds (worked out whatever the mode, so the page can
   *  show it beside a manual override). Null = no trigger word found. */
  auto: BoneRiskMatch | null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first trigger word found in the deck, and the ingredient it sits in. */
export function findBoneRisk(deckText: string, words: readonly string[]): BoneRiskMatch | null {
  const plain = deckText.replace(/\*\*/g, "");
  // Ingredients are separated by commas, brackets, colons and semicolons;
  // checking piece by piece names the ingredient that matched.
  const pieces = plain.split(/[,;:()[\]]/).map(p => p.trim()).filter(Boolean);
  for (const raw of words) {
    const word = raw.trim();
    if (!word) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "iu");
    const piece = pieces.find(p => re.test(p));
    if (piece) return { word, ingredient: piece.replace(/\s+/g, " ").replace(/\.$/, "") };
  }
  return null;
}

export function resolveBonesWarning(setting: BonesSetting, deckText: string, words: readonly string[]): BonesWarning {
  const auto = findBoneRisk(deckText, words);
  if (setting === true) return { on: true, mode: "on", auto };
  if (setting === false) return { on: false, mode: "off", auto };
  return { on: auto != null, mode: "auto", auto };
}
