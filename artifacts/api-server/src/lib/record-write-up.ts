/**
 * "Write up the record notes" for a performance review (Graeme, 26 Nov 2026:
 * "look at all of the notes from the record since the last review … write
 * them up into a short report that captures everything … comes across to
 * the colleague in a way that doesn't look like they're being attacked but
 * gives constructive feedback … clear objectives of what they need to do in
 * the future … just behavioural, more than character"). The prompt and the
 * notes as Claude reads them. Pure, tested. Objective H.
 */
import type { ReportNote } from "@workspace/performance-review";

export function writeUpSystem(firstName: string): string {
  // Bullet points, not prose (Graeme, 26 Nov 2026: "the rewrite is too long …
  // I want it in bullet points without losing any specific point … I wrote
  // the notes, I know how to elaborate … any specific events … cite that,
  // just bullet point them, and have dates next to them").
  return [
    `You turn a manager's notes about one colleague, ${firstName}, into a short bullet-point summary for their performance review at a small food production business. The manager reads from it in the meeting and elaborates in person; ${firstName} may read it too.`,
    "",
    "What matters most, in order:",
    "1. KEEP EVERY POINT. Every point, example, date, number, concern, praise and agreement in the notes must be there. Losing a point is the worst mistake. Merge repeats into one bullet rather than dropping them.",
    "2. SHORT BULLETS, NOT SENTENCES. A few words each, one point per bullet — e.g. '- Quality and thoroughness: a plus', '- Improvements: a real plus, turned around since 15 Sep'. No explanations, no 'why it matters', no linking prose.",
    "3. DATES ON EVENTS. A specific event or observation gets its date in brackets at the end: '- Seen leaving the prep room unwiped (3 Oct)'. Several dates for one thing go together: '(3 Oct, 10 Oct)'. Write dates as '3 Oct'.",
    "4. ADD NOTHING. No facts, judgements, causes or advice that aren't in the notes. Don't guess at reasons or feelings.",
    "5. BEHAVIOUR, NOT CHARACTER. What was seen or done, never labels about the person (not 'lazy', 'careless', 'attitude problem'). No 'always' or 'never'. Neutral and fair, never sarcastic, never softened until the point is lost.",
    "6. OBJECTIVES. Numbered, a few words each, specific and checkable; one per thing to work on, plus any already agreed in the notes (with the date agreed). Use the notes' own deadlines if they give them.",
    "",
    "Sensitive things (health, personal circumstances) stay factual and brief.",
    "Format: plain text with these headings on their own lines — 'Going well', 'To work on', 'Objectives' — '- ' bullets under the first two and '1. ' numbers under 'Objectives'. Leave out a heading with nothing under it. No bold or other markdown, no introduction or sign-off. UK English. Reply with the summary only.",
  ].join("\n");
}

const KIND: Record<string, string> = { note: "Note", feedback: "Feedback", objective: "Objective", agreement: "What was agreed" };

/** The notes as Claude reads them: oldest first, each with its date, kind and meeting. */
export function notesForWriteUp(notes: { fromLastReview: ReportNote[]; list: ReportNote[] }): string {
  const seen = new Set<number>();
  const out: string[] = [];
  if (notes.fromLastReview.length) {
    out.push("## Objectives and agreements from their last review (say how they've gone, if the notes show it)");
    for (const n of notes.fromLastReview) { seen.add(n.id); out.push(line(n)); }
    out.push("");
  }
  const rest = notes.list.filter(n => !seen.has(n.id)).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  if (rest.length) {
    out.push("## Notes since then, oldest first");
    for (const n of rest) out.push(line(n));
  }
  return out.join("\n").trim();
}

function line(n: ReportNote): string {
  const head = [n.date, KIND[n.kind] ?? n.kind, n.entryTitle ? `(${n.entryTitle})` : null, n.title && n.title !== n.entryTitle ? `— ${n.title}` : null]
    .filter(Boolean).join(" ");
  return `- [${head}] ${n.body.trim().replace(/\s*\n\s*/g, " / ")}`;
}

/** How many notes it was written from. */
export function noteCount(notes: { fromLastReview: ReportNote[]; list: ReportNote[] }): number {
  return new Set([...notes.fromLastReview, ...notes.list].map(n => n.id)).size;
}

/**
 * The notes a saved write-up replaces (Graeme, 26 Nov 2026: "actually delete
 * the note off the system that it has read them from … it replaces them, not
 * putting them in addition"): the loose private notes it was written from.
 * Never a note on a meeting (that's the meeting's own record), never one
 * already shared with the colleague, never last review's objectives.
 */
export function replaceableNoteIds(notes: { fromLastReview: ReportNote[]; list: ReportNote[] }): number[] {
  const kept = new Set(notes.fromLastReview.map(n => n.id));
  return [...new Set(notes.list.filter(n => !kept.has(n.id) && n.entryId == null && !n.shared).map(n => n.id))].sort((a, b) => a - b);
}
