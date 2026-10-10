/**
 * Automatic QUID — which recipe lines must show a percentage on the label.
 * Pure logic, no I/O (Graeme, 2026-10-10). Objectives A and D.
 *
 * The law (UK FIC Art. 22): an ingredient — or a category of ingredients —
 * named in the product's name must show its percentage (QUID) in the
 * ingredients list, worked out from its weight at mixing as a share of the
 * whole recipe. The deck already does the arithmetic from live weights
 * (lib/ingredient-deck.ts); this file decides WHICH lines are QUID.
 *
 * How a recipe name is read:
 *  1. The name is normalised: lower case, accents and apostrophes dropped,
 *     "&" read as "and", plurals folded ("Mushrooms" = "mushroom").
 *  2. It is walked left to right, longest phrase first, against the QUID
 *     words list (quid_terms, editable in Settings → "QUID words"):
 *       - auto     the phrase names an ingredient: matching lines are ticked
 *                  automatically ("chicken", "pulled pork" → pork,
 *                  "cheeseburger" → beef + every cheese).
 *       - suggest  a flavour word that may or may not be a characterising
 *                  ingredient ("BBQ", "Honey", "Hot"): matching lines are
 *                  offered as a question, never ticked on their own.
 *       - ignore   made-up names and filler ("Carnizone", "The", "Calzone"):
 *                  never looked for.
 *     A rule's targets may pull in another rule with "@" ("@cheese"), and a
 *     category rule also matches lines by ingredient category ("cheese" →
 *     every ingredient in the cheese category plus the cheese words).
 *  3. Any other word of 3+ letters that happens to appear in a line's name
 *     is only ever a suggestion — a new word is never ticked automatically
 *     until someone adds it to the list.
 *
 * How a line is matched: its name, plus its label declaration's name when
 * the declaration is a single item ("Fior Di Latte" declares "Mozzarella").
 * Every word of the target must appear in the line ("caramelised onion"
 * matches "Caramelised Red Onion Chutney").
 *
 * Sub-recipes: when a word names something INSIDE a sub-recipe (the chicken
 * in "Chicken, Leek & Tarragon Pie Filling", the macaroni in "Macaroni
 * Cheese"), the component inside is QUID — its share of the whole product —
 * not the whole sub-recipe. Only when nothing inside matches does the
 * sub-recipe line itself carry the percentage ("Garlic Butter").
 *
 * A product that is a single sub-recipe (TCK Garlic Mayo, a bag of fried
 * chicken strips) is never QUID as a whole — it would only print "(100%)";
 * only what's inside it is looked at.
 *
 * Guards: a line whose name contains a guard word (dough, base, seasoning,
 * rub, mix, stock, powder, …) is never ticked automatically — "Chicken
 * Seasoning Mix" is not the chicken. It is offered as a suggestion only when
 * nothing else in the recipe answers that word.
 */

export type QuidTermMode = "auto" | "suggest" | "ignore" | "guard";

export interface QuidTerm {
  /** Words as they appear in a recipe name (ignore/auto/suggest) or in a
   *  line name (guard). Normalised by the matcher. */
  phrase: string;
  mode: QuidTermMode;
  /** What to look for in the lines. Empty = the phrase itself. "@x" pulls
   *  in rule x's targets and categories. */
  targets?: string[];
  /** Also match lines whose ingredient category is one of these. */
  categories?: string[];
  /** The phrase names a category (cheese, vegetables) — every matching line
   *  is ticked, each with its own percentage. */
  isCategory?: boolean;
}

export interface QuidComponentInput {
  ingredientId: number;
  name: string;
  declaration: string | null;
  category: string | null;
}

export interface QuidLineInput {
  kind: "ingredient" | "subRecipe";
  /** ingredient id or sub-recipe id */
  id: number;
  name: string;
  declaration: string | null;
  category: string | null;
  /** For a sub-recipe: its ingredients, nested sub-recipes flattened. */
  components?: QuidComponentInput[];
}

export type QuidTarget =
  | { kind: "ingredient"; ingredientId: number }
  | { kind: "subRecipe"; subRecipeId: number }
  | { kind: "component"; subRecipeId: number; ingredientId: number };

export interface QuidDecision {
  target: QuidTarget;
  key: string;
  /** What the line is called, for people ("Garlic Cloves in Garlic Confit"). */
  label: string;
  level: "auto" | "suggest";
  /** The words from the recipe name, as written there ("Chorizo"). */
  term: string;
  isCategory: boolean;
}

export interface QuidMatchResult {
  decisions: QuidDecision[];
  /** Words from the auto list that are in the name but match no line —
   *  worth a look (e.g. chorizo bought under another name). */
  unmatched: string[];
}

export function quidTargetKey(t: QuidTarget): string {
  if (t.kind === "ingredient") return `i:${t.ingredientId}`;
  if (t.kind === "subRecipe") return `s:${t.subRecipeId}`;
  return `c:${t.subRecipeId}:${t.ingredientId}`;
}

/** The reverse of quidTargetKey — null for anything malformed. */
export function parseQuidKey(key: string): QuidTarget | null {
  const m = /^(?:i:(\d+)|s:(\d+)|c:(\d+):(\d+))$/.exec(key);
  if (!m) return null;
  if (m[1]) return { kind: "ingredient", ingredientId: Number(m[1]) };
  if (m[2]) return { kind: "subRecipe", subRecipeId: Number(m[2]) };
  return { kind: "component", subRecipeId: Number(m[3]), ingredientId: Number(m[4]) };
}

/** One word, folded: accents and apostrophes off, plurals folded so
 *  mushroom/mushrooms, chilli/chillies/chillis, tomato/tomatoes, berry/
 *  berries all agree. Applied to both sides, so it only has to be consistent. */
export function foldWord(w: string): string {
  let s = w;
  if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith("ie")) s = s.slice(0, -1);       // chillie → chilli, berrie → berri
  else if (s.length > 3 && s.endsWith("y")) s = s.slice(0, -1) + "i"; // berry → berri
  if (s.length > 3 && s.endsWith("oe")) s = s.slice(0, -1);       // tomatoe → tomato
  return s;
}

/** Text → folded words. "&" reads as "and"; apostrophes vanish ("Nanny's"
 *  → "nanny"); anything else that isn't a letter or digit splits words. */
export function words(text: string | null | undefined): string[] {
  if (!text) return [];
  const s = text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]s\b/g, "")
    .replace(/['’`]/g, "");
  return s.split(/[^a-z0-9]+/).filter(Boolean).map(foldWord);
}

/** The name a declaration starts with, when the declaration is ONE item:
 *  "Mozzarella (Pasteurised MILK, Salt…)" → "Mozzarella". A bare component
 *  list ("Pork (162g…), salt, paprika") names no single thing → null. */
export function declarationHead(declaration: string | null | undefined): string | null {
  const s = (declaration ?? "").trim();
  if (!s) return null;
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) return null;
  }
  const head = s.split("(")[0].trim();
  return head || null;
}

const MIN_FREE_WORD = 3;

interface CompiledRule {
  phrase: string[];
  written: string;
  mode: Exclude<QuidTermMode, "guard">;
  targets: string[][];
  categories: Set<string>;
  isCategory: boolean;
}

function compile(terms: QuidTerm[]) {
  const byPhrase = new Map<string, QuidTerm>();
  for (const t of terms) {
    if (t.mode === "guard") continue;
    const key = words(t.phrase).join(" ");
    if (key) byPhrase.set(key, t);
  }
  const resolve = (t: QuidTerm, seen: Set<string>): { targets: string[][]; categories: Set<string> } => {
    const targets: string[][] = [];
    const categories = new Set((t.categories ?? []).map(c => c.trim().toLowerCase()).filter(Boolean));
    const raw = t.targets && t.targets.length ? t.targets : [t.phrase];
    for (const r of raw) {
      if (r.startsWith("@")) {
        const ref = words(r.slice(1)).join(" ");
        const other = byPhrase.get(ref);
        if (!other || seen.has(ref)) continue;
        const sub = resolve(other, new Set([...seen, ref]));
        targets.push(...sub.targets);
        for (const c of sub.categories) categories.add(c);
      } else {
        const w = words(r);
        if (w.length) targets.push(w);
      }
    }
    return { targets, categories };
  };
  const rules: CompiledRule[] = [];
  for (const [key, t] of byPhrase) {
    const { targets, categories } = t.mode === "ignore" ? { targets: [], categories: new Set<string>() } : resolve(t, new Set([key]));
    rules.push({
      phrase: key.split(" "),
      written: t.phrase,
      mode: t.mode as CompiledRule["mode"],
      targets,
      categories,
      isCategory: t.isCategory === true || categories.size > 0,
    });
  }
  // Longest phrase first, so "garlic butter" wins over "garlic".
  rules.sort((a, b) => b.phrase.length - a.phrase.length);
  const guards = new Set(terms.filter(t => t.mode === "guard").flatMap(t => words(t.phrase)));
  return { rules, guards };
}

interface Candidate {
  target: QuidTarget;
  label: string;
  words: Set<string>;
  category: string | null;
  guarded: boolean;
}

function lineWords(name: string, declaration: string | null): Set<string> {
  return new Set([...words(name), ...words(declarationHead(declaration))]);
}

function hasAll(set: Set<string>, target: string[]): boolean {
  return target.length > 0 && target.every(w => set.has(w));
}

/** Split the recipe name into the terms to look for, as written there. */
function readName(name: string, rules: CompiledRule[]) {
  // Keep the original spelling of each word for messages.
  const rawWords = (name ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`]s\b/g, "").replace(/['’`]/g, "")
    .split(/[^A-Za-z0-9]+/).filter(Boolean);
  const folded = rawWords.map(w => foldWord(w.toLowerCase()));
  const out: Array<{ rule: CompiledRule | null; written: string; folded: string[] }> = [];
  let i = 0;
  while (i < folded.length) {
    const rule = rules.find(r => r.phrase.every((p, k) => folded[i + k] === p));
    if (rule) {
      out.push({ rule, written: rawWords.slice(i, i + rule.phrase.length).join(" "), folded: rule.phrase });
      i += rule.phrase.length;
      continue;
    }
    const w = folded[i];
    if (w.length >= MIN_FREE_WORD && /[a-z]/.test(w) && !/^\d/.test(w)) {
      out.push({ rule: null, written: rawWords[i], folded: [w] });
    }
    i += 1;
  }
  return out;
}

/** Decide which lines of a recipe are QUID because of its name. */
export function matchQuid(recipeName: string, lines: QuidLineInput[], terms: QuidTerm[]): QuidMatchResult {
  const { rules, guards } = compile(terms);
  const isGuarded = (ws: Set<string>) => [...ws].some(w => guards.has(w));

  // Every place a term could land: direct lines, and the components inside
  // each sub-recipe line.
  const direct: Candidate[] = [];
  const subs: Array<{ line: Candidate; components: Candidate[] }> = [];
  for (const l of lines) {
    const ws = lineWords(l.name, l.declaration);
    if (l.kind === "ingredient") {
      direct.push({ target: { kind: "ingredient", ingredientId: l.id }, label: l.name.trim(), words: ws, category: l.category?.toLowerCase() ?? null, guarded: isGuarded(ws) });
    } else {
      const comps = (l.components ?? []).map(c => {
        const cws = lineWords(c.name, c.declaration);
        return {
          target: { kind: "component", subRecipeId: l.id, ingredientId: c.ingredientId } as QuidTarget,
          label: `${c.name.trim()} in ${l.name.trim()}`,
          words: cws, category: c.category?.toLowerCase() ?? null, guarded: isGuarded(cws),
        };
      });
      subs.push({ line: { target: { kind: "subRecipe", subRecipeId: l.id }, label: l.name.trim(), words: ws, category: null, guarded: isGuarded(ws) }, components: comps });
    }
  }

  // A product that is one sub-recipe (a bottle of TCK Garlic Mayo, a bag
  // of fried chicken strips) would only ever print "(100%)" against it:
  // look inside it, never at the line itself.
  const wholeProduct = lines.length === 1 && lines[0].kind === "subRecipe";

  const found = new Map<string, QuidDecision>();
  const put = (c: Candidate, level: "auto" | "suggest", term: string, isCategory: boolean) => {
    const key = quidTargetKey(c.target);
    const prev = found.get(key);
    if (prev && (prev.level === "auto" || level === "suggest")) return;
    found.set(key, { target: c.target, key, label: c.label, level, term, isCategory });
  };
  const unmatched: string[] = [];

  for (const t of readName(recipeName, rules)) {
    const rule = t.rule;
    if (rule?.mode === "ignore") continue;
    const targets = rule ? rule.targets : [t.folded];
    const categories = rule ? rule.categories : new Set<string>();
    const level: "auto" | "suggest" = rule?.mode === "auto" ? "auto" : "suggest";
    const matches = (c: Candidate) => targets.some(tw => hasAll(c.words, tw)) || (c.category != null && categories.has(c.category));

    const strong: Candidate[] = [];
    const weak: Candidate[] = [];
    for (const c of direct) if (matches(c)) (c.guarded ? weak : strong).push(c);
    for (const s of subs) {
      const inner = s.components.filter(matches);
      const innerStrong = inner.filter(c => !c.guarded);
      if (innerStrong.length) {
        strong.push(...innerStrong);
        weak.push(...inner.filter(c => c.guarded));
      } else if (!wholeProduct && matches(s.line)) {
        (s.line.guarded ? weak : strong).push(s.line);
        weak.push(...inner);
      } else {
        weak.push(...inner);
      }
    }

    if (strong.length) {
      for (const c of strong) put(c, level, t.written, rule?.isCategory ?? false);
    } else if (weak.length) {
      // Only guarded lines (a seasoning, a base) carry the word: ask, never tick.
      for (const c of weak) put(c, "suggest", t.written, rule?.isCategory ?? false);
    } else if (rule?.mode === "auto") {
      unmatched.push(t.written);
    }
  }

  return { decisions: [...found.values()], unmatched: [...new Set(unmatched)] };
}

/**
 * The QUID words list as shipped (migration 0165 seeds exactly this; a test
 * checks the two agree). After that the database copy is the one used, and
 * Settings → "QUID words" edits it.
 */
export const DEFAULT_QUID_TERMS: QuidTerm[] = [
  // Meat and fish
  { phrase: "chicken", mode: "auto" },
  { phrase: "beef", mode: "auto" },
  { phrase: "steak", mode: "auto", targets: ["beef", "steak"] },
  { phrase: "cheesesteak", mode: "auto", targets: ["beef", "steak"] },
  { phrase: "burger", mode: "auto", targets: ["beef"] },
  { phrase: "cheeseburger", mode: "auto", targets: ["beef", "@cheese"] },
  { phrase: "brisket", mode: "auto", targets: ["brisket", "beef"] },
  { phrase: "pork", mode: "auto" },
  { phrase: "pulled pork", mode: "auto", targets: ["pork"] },
  { phrase: "lamb", mode: "auto" },
  { phrase: "duck", mode: "auto" },
  { phrase: "turkey", mode: "auto" },
  { phrase: "bacon", mode: "auto" },
  { phrase: "ham", mode: "auto" },
  { phrase: "sausage", mode: "auto" },
  { phrase: "pigs in blankets", mode: "auto", targets: ["pigs in blankets", "sausage", "bacon"] },
  { phrase: "pigs and blankets", mode: "auto", targets: ["pigs in blankets", "sausage", "bacon"] },
  { phrase: "chorizo", mode: "auto" },
  { phrase: "pepperoni", mode: "auto" },
  { phrase: "salami", mode: "auto" },
  { phrase: "pastrami", mode: "auto" },
  { phrase: "nduja", mode: "auto" },
  { phrase: "meatball", mode: "auto" },
  { phrase: "prawn", mode: "auto" },
  { phrase: "salmon", mode: "auto" },
  { phrase: "tuna", mode: "auto" },
  // Cheese
  { phrase: "cheese", mode: "auto", isCategory: true, categories: ["cheese"], targets: ["cheese", "mozzarella", "fior di latte", "cheddar", "feta", "monterey jack", "parmesan", "parmigiano", "grana padano", "pecorino", "provolone", "halloumi", "ricotta", "mascarpone", "gouda", "emmental", "gruyere", "brie", "camembert", "stilton", "red leicester", "burrata", "paneer"] },
  { phrase: "fior di latte", mode: "auto" },
  { phrase: "mozzarella", mode: "auto" },
  { phrase: "cheddar", mode: "auto" },
  { phrase: "feta", mode: "auto" },
  { phrase: "halloumi", mode: "auto" },
  { phrase: "goats cheese", mode: "auto", targets: ["goat"] },
  { phrase: "garlic butter", mode: "auto" },
  // Pasta
  { phrase: "macaroni", mode: "auto", targets: ["macaroni", "pasta"], categories: ["pasta"] },
  { phrase: "mac", mode: "auto", targets: ["macaroni", "pasta"], categories: ["pasta"] },
  { phrase: "pasta", mode: "auto", targets: ["pasta", "macaroni"], categories: ["pasta"] },
  // Vegetables, herbs, fruit
  { phrase: "vegetables", mode: "auto", isCategory: true, categories: ["vegetable"] },
  { phrase: "veg", mode: "auto", isCategory: true, categories: ["vegetable"] },
  { phrase: "veggie", mode: "auto", isCategory: true, categories: ["vegetable"] },
  { phrase: "mushroom", mode: "auto" },
  { phrase: "garlic", mode: "auto" },
  { phrase: "onion", mode: "auto" },
  { phrase: "red onion", mode: "auto" },
  { phrase: "caramelised onion", mode: "auto" },
  { phrase: "leek", mode: "auto" },
  { phrase: "chilli", mode: "auto", targets: ["chilli", "chili"] },
  { phrase: "jalapeno", mode: "auto" },
  { phrase: "red pepper", mode: "auto" },
  { phrase: "spinach", mode: "auto" },
  { phrase: "tomato", mode: "auto" },
  { phrase: "sweetcorn", mode: "auto" },
  { phrase: "olive", mode: "auto" },
  { phrase: "potato", mode: "auto" },
  { phrase: "tarragon", mode: "auto" },
  { phrase: "sage", mode: "auto" },
  { phrase: "mint", mode: "auto" },
  { phrase: "minted", mode: "auto", targets: ["mint"] },
  { phrase: "rosemary", mode: "auto" },
  { phrase: "basil", mode: "auto" },
  { phrase: "pesto", mode: "auto" },
  { phrase: "truffle", mode: "auto" },
  { phrase: "cranberry", mode: "auto" },
  { phrase: "stuffing", mode: "auto" },
  { phrase: "apple", mode: "auto" },
  // Flavour words — a question, never ticked on their own
  { phrase: "bbq", mode: "suggest", targets: ["bbq", "barbecue"] },
  { phrase: "barbecue", mode: "suggest", targets: ["bbq", "barbecue"] },
  { phrase: "honey", mode: "suggest" },
  { phrase: "chipotle", mode: "suggest" },
  { phrase: "hot", mode: "suggest" },
  { phrase: "spicy", mode: "suggest" },
  { phrase: "smoky", mode: "suggest" },
  { phrase: "piri piri", mode: "suggest", targets: ["piri piri", "peri peri"] },
  { phrase: "peri peri", mode: "suggest", targets: ["piri piri", "peri peri"] },
  { phrase: "korma", mode: "suggest" },
  { phrase: "tikka", mode: "suggest" },
  { phrase: "balsamic", mode: "suggest" },
  { phrase: "buffalo", mode: "suggest" },
  { phrase: "jerk", mode: "suggest" },
  { phrase: "teriyaki", mode: "suggest" },
  { phrase: "hoisin", mode: "suggest" },
  { phrase: "fajita", mode: "suggest" },
  { phrase: "sriracha", mode: "suggest" },
  { phrase: "buttermilk", mode: "suggest" },
  // Stop-list: made-up names and filler — never looked for
  ...[
    "the", "and", "with", "in", "on", "of", "double", "triple", "big", "nanny", "open", "fire", "roasted", "roast", "slow",
    "cooked", "pulled", "special", "calzone", "pie", "dinner", "christmas", "festive", "fried", "protein", "draft",
    "korean", "philly", "texican", "texibean", "cinco", "carnage", "con", "carne", "benji", "godfather", "donald", "don",
    "carnizone", "properoni", "margherita", "tck", "mayo", "dough", "ball", "club", "original", "classic", "loaded",
    "kitchen", "style", "new", "deluxe", "ultimate", "mini", "test", "wonky", "box", "pack", "bun",
  ].map(phrase => ({ phrase, mode: "ignore" as const })),
  // Guards: a line with one of these words is never ticked automatically
  ...[
    "dough", "base", "seasoning", "rub", "mix", "stock", "bouillon", "powder", "granules", "flavour", "flavouring",
    "extract", "salt", "breading", "marinade",
  ].map(phrase => ({ phrase, mode: "guard" as const })),
];
