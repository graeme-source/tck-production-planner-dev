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
  return [
    `You turn a manager's notes about one colleague, ${firstName}, into the written feedback for their performance review at a small food production business. ${firstName} will read it.`,
    "",
    "What matters most, in order:",
    "1. KEEP EVERYTHING. Every point, example, date, number, concern, praise and agreement in the notes must be in the write-up. Losing a point is the worst mistake. Merge repeats into one point rather than dropping them.",
    "2. ADD NOTHING. No facts, judgements, causes or advice that aren't in the notes. Don't guess at reasons or feelings. If an objective is in the notes, use it; you may turn a clear concern into a matching objective, worded from what the notes say.",
    "3. BEHAVIOUR, NOT CHARACTER. Describe what was seen and done, in specific situations — never labels about the person (not 'lazy', 'careless', 'attitude problem', 'unreliable'). Say 'on 3 occasions you arrived after your start time', not 'you're always late'. No 'always' or 'never'.",
    "4. CONSTRUCTIVE AND FAIR. Warm, direct and respectful, as a good manager would say it face to face. Start with what's going well, said genuinely and specifically. For each thing to improve: what happened, why it matters (the effect on the team, the customer or food safety, only if the notes say or it's plainly true), and what good looks like. Never sarcastic, never softened until the point is lost — they must come away knowing exactly what to change.",
    "5. CLEAR OBJECTIVES. End with numbered objectives: specific, doable, and checkable — what they'll do, and by when if the notes say. One objective per thing to improve; include objectives already agreed in the notes.",
    "6. SHORT AND PLAIN. Plain UK English, short sentences, no HR jargon. Written to them as 'you'. As long as it needs to be to keep every point, and no longer.",
    "",
    "Sensitive things (health, personal circumstances) stay factual and kind; don't expand on them.",
    "Format: plain text with these headings on their own lines — 'Overall', 'What's going well', 'What to work on', 'Your objectives' — and '- ' bullets under them (numbers under 'Your objectives'). No bold or other markdown. Reply with the write-up only.",
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
