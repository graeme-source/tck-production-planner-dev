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
  // just bullet point them, and have dates next to them"). Then, the same
  // day: start with positives, the constructive bit in the middle, finish
  // with the personal positives; no separate objectives (they duplicate the
  // feedback); sections with headlines and a bold topic on each point —
  // the page shows "Topic: detail" with the topic in bold and a tick box.
  return [
    `You turn a manager's notes about one colleague, ${firstName}, into short bullet-point talking points for their performance review at a small food production business. The manager talks from them in the meeting, ticking each point off as it's covered, and elaborates in person; ${firstName} may read them too.`,
    "",
    "What matters most, in order:",
    "1. KEEP EVERY POINT, ONCE. Every point, example, date, number, concern, praise and agreement in the notes must be there — losing a point is the worst mistake — but each only once. Notes often say the same thing several times (an earlier write-up, meeting notes, objectives): combine similar or overlapping points into one bullet, with all their dates and details. Make it as short as it can be without losing anything.",
    "2. TOPIC: DETAIL. Every bullet is a short topic, a colon, then a few words of detail — e.g. '- Quality and thoroughness: a plus', '- Mix and prep speed: little or no change since agreed (17 Sep)'. The topic is 1–5 words. No explanations, no 'why it matters', no linking prose.",
    "3. DATES ON EVENTS. A specific event or observation gets its date in brackets at the end: '- Prep room: left unwiped (3 Oct)'. Several dates for one thing go together: '(3 Oct, 10 Oct)'. Write dates as '3 Oct'.",
    "4. ADD NOTHING. No facts, judgements, causes or advice that aren't in the notes. Don't guess at reasons or feelings. The one exception is the last bullet (below).",
    "5. BEHAVIOUR, NOT CHARACTER, in the points to work on: what was seen or done, never labels about the person (not 'lazy', 'careless', 'attitude problem'). No 'always' or 'never'. Neutral and fair, never sarcastic, never softened until the point is lost.",
    "6. NO SEPARATE OBJECTIVES. Don't list objectives at the end — they repeat the feedback. Put what was agreed, the target and what good looks like as bullets under the topic they belong to (e.g. '- Agreed: more little-and-often washing up (17 Sep)', '- Good looks like: work first, no stopping to chat'). Objectives from their last review go under their topic too, with how they've gone if the notes say.",
    "",
    "Layout — three sections, each heading on its own line, in this order:",
    "Start with",
    "  The work positives: quality, skills, effort, improvements, things done well.",
    "To work on",
    "  Grouped into a few topics, each with a short sub-heading on its own line ending with ':' (e.g. 'Speed and output:', 'Food safety:', 'Packing:'), its bullets underneath. Most important topic first.",
    "Finish with",
    "  The personal positives from the notes — what they're like to work with, how they get on with the team, anything warm the notes say. Then one last bullet looking ahead in the manager's voice, e.g. '- Going forward: really hopeful we'll see lots of improvement'.",
    "Leave out a section with nothing in it from the notes (but always keep the looking-ahead bullet).",
    "",
    "Sensitive things (health, personal circumstances) stay factual and brief.",
    "Format: plain text. Headings on their own lines, '- ' bullets. No numbering, no bold or other markdown, no introduction or sign-off. UK English. Reply with the talking points only.",
  ].join("\n");
}

const KIND: Record<string, string> = { note: "Note", feedback: "Feedback", objective: "Objective", agreement: "What was agreed" };

/** The notes as Claude reads them: oldest first, each with its date, kind and meeting. */
export function notesForWriteUp(notes: { fromLastReview: ReportNote[]; list: ReportNote[] }): string {
  const seen = new Set<number>();
  const out: string[] = [];
  if (notes.fromLastReview.length) {
    out.push("## Objectives and agreements from their last review (put each under its topic in To work on, with how it's gone if the notes say)");
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
