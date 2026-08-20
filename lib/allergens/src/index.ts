// UK14 allergen keyword engine — single source of truth for:
//   1. BOLDING: which words in a label declaration get **emphasis** on the
//      ingredient deck. UK FIC requires emphasis on the actual word printed
//      ("BARLEY", "OATS", "SOYA"), not our internal tick label ("Wheat"), so
//      bolding is driven by the declaration TEXT, not by the ticked allergens.
//   2. DETECTION: which UK14 allergens a declaration implies, used to mirror
//      the declaration into the ingredient's ticked-allergen list and to flag
//      declaration-vs-ticks mismatches on the deck.
// Shared by the API server (deck build, save-time mirroring) and the app
// (form auto-tick, sub-recipe deck preview) so the two can never drift.

export const UK14_CODES = [
  "celery", "cereals_containing_gluten", "crustaceans", "eggs", "fish",
  "lupin", "milk", "molluscs", "mustard", "nuts", "peanuts", "sesame",
  "soybeans", "sulphur_dioxide",
] as const;

export type AllergenCode = (typeof UK14_CODES)[number];

export const ALLERGEN_DISPLAY: Record<string, string> = {
  celery: "Celery",
  cereals_containing_gluten: "Wheat",
  crustaceans: "Crustaceans",
  eggs: "Eggs",
  fish: "Fish",
  lupin: "Lupin",
  milk: "Milk",
  molluscs: "Molluscs",
  mustard: "Mustard",
  nuts: "Nuts",
  peanuts: "Peanuts",
  sesame: "Sesame",
  soybeans: "Soybeans",
  sulphur_dioxide: "Sulphur Dioxide",
};

// Words/phrases that ARE the allergen as printed — these get bolded when they
// appear in a declaration, and imply the allergen for detection. Phrases are
// allowed ("sulphur dioxide"). Matching is case-insensitive on word
// boundaries, so "nutmeg", "coconut" and "Cornflour" never match "nut",
// "nut"/"milk" or "flour".
const BOLD_KEYWORDS: Record<AllergenCode, string[]> = {
  celery: ["celery", "celeriac"],
  cereals_containing_gluten: [
    "gluten", "wheat", "wheatflour", "barley", "rye", "oat", "oats",
    "spelt", "kamut", "semolina", "durum", "couscous", "bulgur", "seitan", "farro",
  ],
  crustaceans: [
    "crustacean", "crustaceans", "prawn", "prawns", "shrimp", "shrimps",
    "crab", "lobster", "crayfish", "langoustine", "scampi", "krill",
  ],
  eggs: ["egg", "eggs", "albumen", "albumin", "ovalbumin"],
  fish: [
    "fish", "anchovy", "anchovies", "tuna", "salmon", "cod", "haddock",
    "pollock", "pollack", "sardine", "sardines", "pilchard", "pilchards",
    "mackerel", "trout", "herring", "plaice", "halibut", "sea bass",
    "sprat", "sprats", "whitebait",
  ],
  lupin: ["lupin", "lupine", "lupini"],
  milk: [
    "milk", "buttermilk", "butter", "cream", "cheese", "yogurt", "yoghurt",
    "whey", "casein", "caseinate", "caseinates", "lactose", "curd", "curds",
    "ghee", "creme fraiche", "crème fraîche",
  ],
  molluscs: [
    "mollusc", "molluscs", "mussel", "mussels", "oyster", "oysters",
    "squid", "calamari", "clam", "clams", "scallop", "scallops",
    "octopus", "snail", "snails", "whelk", "whelks", "cockle", "cockles",
  ],
  mustard: ["mustard"],
  nuts: [
    "nut", "nuts", "almond", "almonds", "hazelnut", "hazelnuts",
    "walnut", "walnuts", "cashew", "cashews", "pecan", "pecans",
    "pistachio", "pistachios", "macadamia", "macadamias",
  ],
  peanuts: ["peanut", "peanuts", "groundnut", "groundnuts", "arachis"],
  sesame: ["sesame", "tahini"],
  soybeans: ["soy", "soya", "soja", "soybean", "soybeans", "tofu", "edamame", "tempeh"],
  sulphur_dioxide: [
    "sulphur dioxide", "sulfur dioxide", "sulphite", "sulphites",
    "sulfite", "sulfites", "metabisulphite", "metabisulfite",
    "bisulphite", "bisulfite",
    "e220", "e221", "e222", "e223", "e224", "e226", "e227", "e228",
  ],
};

// Words that IMPLY an allergen for detection/mirroring but are compound
// ingredient names rather than the allergen word itself, so they are NOT
// bolded (FIC emphasis belongs on e.g. the "MILK" inside "Mozzarella
// (pasteurised MILK, …)", not on "Mozzarella").
const DETECT_ONLY_KEYWORDS: Partial<Record<AllergenCode, string[]>> = {
  cereals_containing_gluten: ["malt", "malted"],
  milk: [
    "mozzarella", "cheddar", "parmesan", "parmigiano", "grana padano",
    "mascarpone", "feta", "halloumi", "ricotta", "brie", "stilton",
    "gouda", "taleggio", "gorgonzola", "pecorino", "paneer", "quark",
    "monterey jack",
  ],
  nuts: ["praline", "marzipan", "frangipane"],
  soybeans: ["miso"],
};

// "milk", "cream" or "butter" preceded by one of these is a plant product,
// not dairy — "coconut milk", "peanut butter", "oat milk", "cocoa butter".
const NON_DAIRY_MODIFIERS = new Set([
  "coconut", "cocoa", "shea", "peanut", "almond", "cashew", "hazelnut",
  "macadamia", "walnut", "nut", "oat", "soya", "soy", "rice", "hemp",
  "plant", "vegan",
]);
const DAIRY_AMBIGUOUS = new Set(["milk", "cream", "butter"]);

export type AllergenMatch = {
  code: AllergenCode;
  start: number;
  end: number;
  word: string;
  boldable: boolean;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Spans of the text where allergen words don't count: "may contain …"
// cross-contamination statements (not part of the recipe, never emphasised)
// and "free from …" claims.
function protectedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /\b(may (?:also )?contain|free from)\b[^.;]*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

function inRanges(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => pos >= s && pos < e);
}

function wordBefore(text: string, start: number): string | null {
  const head = text.slice(0, start);
  const m = /([a-zA-Z]+)[\s-]+$/.exec(head);
  return m ? m[1].toLowerCase() : null;
}

/** All allergen keyword matches in a declaration, with guards applied. */
export function findAllergenMatches(text: string): AllergenMatch[] {
  if (!text) return [];
  const protectedR = protectedRanges(text);
  const matches: AllergenMatch[] = [];

  const scan = (code: AllergenCode, keyword: string, boldable: boolean) => {
    // \b doesn't work after non-word chars like "é"; the keyword list is
    // plain-ASCII apart from "crème fraîche", which regex-escapes fine.
    const re = new RegExp(`(?<![a-zA-Z])(${escapeRegExp(keyword)})(?![a-zA-Z])`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[1].length;
      if (inRanges(start, protectedR)) continue;
      // "gluten free" / "gluten-free" / "dairy free" style claims.
      if (/^[\s-]?free\b/i.test(text.slice(end))) continue;
      const lower = m[1].toLowerCase();
      if (DAIRY_AMBIGUOUS.has(lower)) {
        const prev = wordBefore(text, start);
        if (prev && NON_DAIRY_MODIFIERS.has(prev)) continue;
        // "cream of tartar" and "butter beans" are not dairy.
        if (lower === "cream" && /^\s+of\s+tartar\b/i.test(text.slice(end))) continue;
        if (lower === "butter" && /^\s+beans?\b/i.test(text.slice(end))) continue;
      }
      matches.push({ code, start, end, word: m[1], boldable });
    }
  };

  for (const code of UK14_CODES) {
    for (const kw of BOLD_KEYWORDS[code]) scan(code, kw, true);
    for (const kw of DETECT_ONLY_KEYWORDS[code] ?? []) scan(code, kw, false);
  }

  // Longest-match-first, then drop overlaps ("sulphur dioxide" beats any
  // shorter match inside it; "buttermilk" beats "butter"+"milk").
  matches.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept: AllergenMatch[] = [];
  for (const m of matches) {
    if (kept.some(k => m.start < k.end && k.start < m.end)) continue;
    kept.push(m);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** UK14 codes implied by a declaration text. */
export function detectAllergens(text: string | null | undefined): AllergenCode[] {
  if (!text) return [];
  return [...new Set(findAllergenMatches(text).map(m => m.code))];
}

/** Bold every allergen word in a declaration with **markdown** emphasis.
 *  Text-driven: whatever allergen word is printed gets emphasised, exactly
 *  as UK FIC requires — independent of what's ticked on the ingredient. */
export function boldAllergens(text: string): string {
  if (!text) return text;
  const bold = findAllergenMatches(text).filter(m => m.boldable);
  let result = text;
  for (let i = bold.length - 1; i >= 0; i--) {
    const m = bold[i];
    // Already emphasised (e.g. text round-tripped through this function).
    if (result.slice(m.start - 2, m.start) === "**" && result.slice(m.end, m.end + 2) === "**") continue;
    result = `${result.slice(0, m.start)}**${m.word}**${result.slice(m.end)}`;
  }
  return result;
}

/** Detected-but-not-ticked allergens — the deck's mismatch warning. */
export function allergenMismatch(
  text: string | null | undefined,
  ticked: string[],
): AllergenCode[] {
  const tickedSet = new Set(ticked);
  return detectAllergens(text).filter(c => !tickedSet.has(c));
}
