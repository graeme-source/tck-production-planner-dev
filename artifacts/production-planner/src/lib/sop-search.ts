/**
 * Finding the SOP that already exists — before someone writes a second one.
 *
 * The SOP picker used to filter on a plain substring of the title, which
 * fails exactly when it matters most: the create form pre-fills the title
 * from the task ("Switch on air vent switch"), no title contains that whole
 * phrase, so the list empties out and the obvious next move is to create a
 * duplicate of the "Air Con Check" SOP nobody saw.
 *
 * So there are two bands of result. `matches` is the literal substring
 * search people expect while typing. `similar` is everything that shares
 * meaningful words — shown underneath, and again next to the create form, so
 * a near-duplicate is on screen at the moment someone is about to make one.
 *
 * Scoring is deliberately crude (shared words over total distinct words,
 * same Jaccard shape as the improvements duplicate check). It only has to be
 * good enough to put a candidate in front of a human; the human decides.
 */

/** Words carrying no signal about what an SOP is about. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "at", "for", "with", "from", "by", "it", "its", "this",
  "that", "these", "those", "we", "i", "you", "they", "our", "us", "there",
  "not", "no", "so", "if", "then", "than", "as", "up", "down", "out", "off",
  "when", "what", "which", "who", "how", "all", "any", "can", "cant", "could",
  "should", "would", "will", "just", "get", "got", "need", "needs", "needed",
  "have", "has", "had", "do", "does", "did", "doing", "keep", "keeps",
  // Words that turn up in half the SOP titles here and so tell us nothing.
  "sop", "process", "procedure",
]);

/** Split a title into meaningful, comparable words. */
export function tokeniseTitle(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

/** How alike two titles are, 0–1: shared words over total distinct words. */
export function titleSimilarity(a: string, b: string): number {
  const setA = tokeniseTitle(a);
  const setB = tokeniseTitle(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared++;
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface RankedSops<T> {
  /** Titles containing what was typed, in library order. */
  matches: T[];
  /** Titles that share meaningful words but aren't a literal match. */
  similar: T[];
}

/**
 * Split a SOP library into what someone literally searched for and what they
 * probably meant. An empty query returns the library head as matches, which
 * is what the picker shows before anyone types.
 */
export function rankSops<T extends { title: string }>(
  query: string,
  sops: T[],
  { matchLimit = 12, similarLimit = 4, minScore = 0.15 }: {
    matchLimit?: number;
    similarLimit?: number;
    minScore?: number;
  } = {},
): RankedSops<T> {
  const needle = query.trim().toLowerCase();
  if (!needle) return { matches: sops.slice(0, matchLimit), similar: [] };

  const matched = new Set<T>();
  const matches: T[] = [];
  for (const sop of sops) {
    if (sop.title.toLowerCase().includes(needle)) {
      matched.add(sop);
      if (matches.length < matchLimit) matches.push(sop);
    }
  }

  const similar = sops
    .filter(s => !matched.has(s))
    .map(s => ({ sop: s, score: titleSimilarity(query, s.title) }))
    .filter(s => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, similarLimit)
    .map(s => s.sop);

  return { matches, similar };
}
