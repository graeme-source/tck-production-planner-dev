/**
 * "Tidy into bullet points" for a manager's private prep notes (Graeme, 26
 * Nov 2026: "shortens them to get rid of a lot of the waffle and put them
 * effectively into bullet points … we don't lose any information … I just
 * need to be able to read them quickly in a meeting"). The prompt, and a
 * check that nothing countable went missing: every number, date and amount
 * in the original should still be in the tidied version — any that aren't
 * are shown before he saves. Pure, tested. Objective H.
 */

export const PREP_TIDY_SYSTEM = [
  "You tidy a manager's private notes for a staff performance review into short bullet points they will read aloud from in the meeting.",
  "Rules, in order of importance:",
  "1. Keep EVERY fact, example, number, date, name, amount, concern, praise and question. Losing information is the worst mistake. When unsure, keep it.",
  "2. Cut only waffle: filler words, repetition, hedging, long-winded phrasing.",
  "3. One idea per bullet, a few words to one short line each. Start each bullet with '- '.",
  "4. Keep the manager's own headings or groupings if they have them (a short line ending with ':' above its bullets); otherwise group related points under short headings only if it clearly helps.",
  "5. Keep their meaning and tone. Don't add advice, conclusions, judgements or anything that isn't in the notes. Don't soften or sharpen what they wrote.",
  "6. UK English. Plain text only: no bold, no markdown other than '- ' bullets and heading lines.",
  "Reply with the tidied notes only — no introduction, no comments.",
].join("\n");

/** Numbers, dates, times, money and percentages, as written (normalised). */
export function countableFacts(text: string): string[] {
  const found = new Set<string>();
  const re = /£\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%|\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b|\b\d{1,2}:\d{2}\b|\b\d[\d,]*(?:\.\d+)?\b/g;
  for (const m of text.matchAll(re)) found.add(m[0].replace(/\s+/g, "").replace(/,/g, "").toLowerCase());
  return [...found];
}

/** Facts in the original that the tidied version no longer has. */
export function missingFacts(original: string, tidied: string): string[] {
  const kept = new Set(countableFacts(tidied));
  const squashed = tidied.replace(/\s+/g, "").replace(/,/g, "").toLowerCase();
  return countableFacts(original).filter(f => !kept.has(f) && !squashed.includes(f));
}
