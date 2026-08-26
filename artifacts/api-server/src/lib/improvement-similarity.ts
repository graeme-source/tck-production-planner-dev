/**
 * Finding the improvements a new report might duplicate.
 *
 * Two stages, deliberately. This module does the cheap one: score every open
 * improvement by word overlap and hand back a shortlist. The expensive one —
 * asking a model whether the shortlist really is the same problem — happens
 * in routes/improvements.ts, on at most a handful of candidates.
 *
 * Doing it this way keeps the model's job small and the cost bounded no
 * matter how many improvements pile up, and it means the "is this a
 * duplicate?" check stays fast enough to run while someone waits at a
 * kitchen iPad. It also degrades honestly: with no API key configured the
 * shortlist alone still surfaces the obvious repeats.
 */

/** Words carrying no signal about what a problem IS. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "at", "for", "with", "from", "by", "it", "its", "this",
  "that", "these", "those", "we", "i", "you", "they", "our", "us", "there",
  "not", "no", "so", "if", "then", "than", "as", "up", "down", "out", "off",
  "when", "what", "which", "who", "how", "all", "any", "can", "cant", "could",
  "should", "would", "will", "just", "get", "got", "need", "needs", "needed",
  "have", "has", "had", "do", "does", "did", "doing", "keep", "keeps",
]);

/** Split text into meaningful, comparable words. */
export function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

/**
 * How alike two pieces of text are, 0–1 (Jaccard: shared words over total
 * distinct words). Crude on purpose — it only has to be good enough to pick
 * a shortlist, and the model makes the actual judgement.
 */
export function similarity(a: string, b: string): number {
  const setA = tokenise(a);
  const setB = tokenise(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared++;
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface CandidateInput {
  id: number;
  title: string;
  description: string;
}

export interface ScoredCandidate extends CandidateInput {
  score: number;
}

/**
 * The most similar open improvements to what someone is reporting.
 *
 * `minScore` keeps unrelated things out of the model's prompt entirely: two
 * reports that share no meaningful words are not the same problem, and asking
 * about them wastes time and money.
 */
export function shortlistDuplicates(
  incoming: { title: string; description?: string },
  candidates: CandidateInput[],
  { limit = 5, minScore = 0.12 }: { limit?: number; minScore?: number } = {},
): ScoredCandidate[] {
  const text = `${incoming.title} ${incoming.description ?? ""}`.trim();
  if (!text) return [];
  return candidates
    .map(c => ({ ...c, score: similarity(text, `${c.title} ${c.description}`) }))
    .filter(c => c.score >= minScore)
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, limit);
}
