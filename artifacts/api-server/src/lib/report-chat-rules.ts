/**
 * AI Jane talks an app report or idea through before it's filed (Graeme,
 * 19 Nov 2026): a few of the questions he'd otherwise come back and ask —
 * must they do it, can they swipe it away, does it come up every time — so
 * the first build is the right one. The pure half: how many questions she
 * may ask, checking what she says, and the summary that goes into the
 * report. No database, unit-tested in report-chat-rules.test.ts.
 *
 * She can never stop a report: any failure files it with what's been said.
 */

export const MAX_QUESTIONS = 4;
export const TALK_THROUGH_SETTING_KEY = "jane_talk_through";
export const TALK_THROUGH_FEATURE = "ai.jane_talk_through";
export const BRIEF_HEADING = "Talked through with AI Jane:";

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type ChatKind = "issue" | "idea";

export type JaneStep =
  | { kind: "question"; message: string; choices: string[] }
  | { kind: "brief"; message: string; brief: string };

/** The switch on the Fix queue. Missing means on: it starts on for managers. */
export function talkThroughOn(value: string | null | undefined): boolean {
  return value !== "off";
}

/** Questions Jane has already asked in this chat. */
export function questionsAsked(history: readonly ChatTurn[]): number {
  return history.filter(t => t.role === "assistant").length;
}

/** Her next move, checked. null = nothing usable (the caller falls back). */
export function checkedStep(raw: { name: string; input: unknown } | null, asked: number): JaneStep | null {
  if (!raw) return null;
  const r = (raw.input ?? {}) as Record<string, unknown>;
  const message = typeof r.message === "string" ? r.message.trim().slice(0, 500) : "";
  if (raw.name === "brief") {
    const brief = typeof r.brief === "string" ? r.brief.trim().slice(0, 2000) : "";
    if (!brief) return null;
    return { kind: "brief", message: message || "Here's what I'll send. Change anything that's wrong, then send it.", brief };
  }
  if (raw.name === "ask") {
    if (!message || asked >= MAX_QUESTIONS) return null;
    const seen = new Set<string>();
    const choices: string[] = [];
    for (const c of Array.isArray(r.choices) ? r.choices : []) {
      if (typeof c !== "string") continue;
      const t = c.trim().slice(0, 60);
      const k = t.toLowerCase();
      if (!t || seen.has(k) || k === "not sure") continue;
      seen.add(k);
      choices.push(t);
      if (choices.length === 4) break;
    }
    return { kind: "question", message, choices };
  }
  return null;
}

/**
 * When Jane can't write the summary, the questions and answers are the
 * summary: nothing they told her is lost.
 */
export function answersAsBrief(history: readonly ChatTurn[]): string | null {
  const lines: string[] = [];
  for (let i = 1; i < history.length; i++) {
    const q = history[i];
    const a = history[i + 1];
    if (q.role === "assistant" && a?.role === "user") {
      lines.push(`${q.text.trim()} — ${a.text.trim()}`);
      i++;
    }
  }
  return lines.length ? lines.join("\n") : null;
}

/** What gets filed: their own words first, then the agreed summary. */
export function describeWithBrief(original: string, brief: string | null | undefined): string {
  const o = original.trim();
  const b = (brief ?? "").trim();
  return b ? `${o}\n\n${BRIEF_HEADING}\n${b}` : o;
}
