/**
 * Talk to Claude about a Fix queue card, live (Graeme, 20 Nov 2026: "rather
 * than sending a message and waiting for a reply an hour later… while I'm
 * active on the page, have a conversation with it"). The pure half: the
 * briefing Claude starts from — the report, what the reporter told AI Jane,
 * the hourly reviewer's recommendation, the comments and history — and the
 * prompt for turning the chat into an instruction. Unit-tested.
 */

export interface ChatReport {
  id: number;
  createdAt: string | Date;
  reporterName: string | null;
  area: string | null;
  station: string | null;
  description: string | null;
}

export interface ChatTriage {
  lane: string | null;
  status: string | null;
  verdictSummary: string | null;
  explanation: string | null;
  proposedFix: string | null;
  objective: string | null;
  blastRadius: string | null;
  confidence: string | number | null;
  behaviourChange: boolean | null;
  questionForGraeme: string | null;
  suggestedReply: string | null;
}

const line = (label: string, v: unknown) => (v == null || String(v).trim() === "" ? null : `${label}: ${String(v).trim()}`);

/** Everything known about the card, as plain text for the system prompt. */
export function chatBriefing(args: {
  report: ChatReport;
  triage: ChatTriage | null;
  comments: Array<{ author: string | null; text: string; at: string | Date }>;
  events: Array<{ event: string; actor: string | null; note: string | null; at: string | Date }>;
  janeChat: Array<{ role: "user" | "assistant"; text: string }> | null;
}): string {
  const { report: r, triage: t } = args;
  const when = (d: string | Date) => new Date(d).toISOString().slice(0, 16).replace("T", " ");
  const parts: string[] = [
    `## The report (#${r.id})`,
    [line("Reported", when(r.createdAt)), line("By", r.reporterName), line("Area", r.area), line("Station", r.station)].filter(Boolean).join("\n"),
    `What they wrote:\n${(r.description ?? "").trim() || "(nothing)"}`,
  ];
  if (args.janeChat && args.janeChat.length > 1) {
    parts.push("## Their chat with AI Jane before filing", args.janeChat.map(m => `${m.role === "user" ? "Reporter" : "Jane"}: ${m.text}`).join("\n"));
  }
  if (t) {
    parts.push("## The hourly reviewer's recommendation", [
      line("Status", t.status), line("Lane", t.lane), line("Summary", t.verdictSummary), line("Explanation", t.explanation),
      line("Proposed fix", t.proposedFix), line("Objective", t.objective), line("Blast radius", t.blastRadius),
      line("Confidence", t.confidence), t.behaviourChange ? "Changes agreed behaviour: yes" : null,
      line("Question for Graeme", t.questionForGraeme), line("Proposed reply to the reporter", t.suggestedReply),
    ].filter(Boolean).join("\n"));
  }
  if (args.comments.length) {
    parts.push("## Comments", args.comments.map(c => `${when(c.at)} ${c.author ?? "Someone"}: ${c.text}`).join("\n"));
  }
  if (args.events.length) {
    parts.push("## History", args.events.slice(-20).map(e => `${when(e.at)} ${e.event}${e.actor ? ` (${e.actor})` : ""}${e.note ? `: ${e.note}` : ""}`).join("\n"));
  }
  return parts.join("\n\n");
}

/** At most this many turns go to Claude; the oldest drop first. */
export const MAX_CHAT_TURNS = 40;

export function trimHistory<T>(history: T[]): T[] {
  return history.length > MAX_CHAT_TURNS ? history.slice(history.length - MAX_CHAT_TURNS) : history;
}

export const SUMMARY_REQUEST = `Turn our conversation into the instruction for the developer who builds fixes (the hourly reviewer). Write it as Graeme, first person, plain English: what's actually wrong (or that nothing is), what the data showed, and exactly what to change and how it should behave — including anything we agreed (who it applies to, when it shows, whether it can be dismissed). Short paragraphs, no headings, no preamble. If we didn't agree a change, say what to investigate next instead.`;
