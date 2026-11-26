/**
 * A record note read as talking points (Graeme, 26 Nov 2026: "put it into
 * sections with headlines, and maybe we put bold on the first bit … 'Mix and
 * prep speed' would be bold, and then 'little or no change since agreed'
 * unbolded, a bit underneath, so it's easy to scan … little tick items next
 * to it, so I can … tick these items off one by one").
 *
 * Plain text in, blocks out:
 *   "Start with"            → heading (a short line on its own)
 *   "Speed and output:"     → sub-heading (a line ending with ':')
 *   "- Topic: detail (date)"→ point, topic in bold, detail under it
 *   "- Just a point"        → point with no topic
 *   anything else           → a paragraph
 * Only notes with a few bullet points are shown this way; anything else
 * keeps its plain text (asTalkingPoints → null). Pure, tested. Objective H.
 */

export type TalkingBlock =
  | { kind: "heading"; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "point"; key: string; topic: string | null; detail: string }
  | { kind: "text"; text: string };

const BULLET = /^\s*(?:[-•*–]|\d{1,2}[.)])\s+(.*)$/;
/** At least this many points before a note is shown as talking points. */
export const MIN_POINTS = 3;

export function asTalkingPoints(body: string): TalkingBlock[] | null {
  const blocks: TalkingBlock[] = [];
  const seen = new Map<string, number>();
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const b = BULLET.exec(line);
    if (b) {
      const text = b[1]!.trim();
      if (!text) continue;
      const { topic, detail } = splitTopic(text);
      // The key is the point's own words, so a tick stays on its point even
      // if the note is edited around it. Repeats get a counter.
      const n = (seen.get(text) ?? 0) + 1;
      seen.set(text, n);
      blocks.push({ kind: "point", key: n === 1 ? text : `${text}#${n}`, topic, detail });
    } else if (line.endsWith(":") && line.length <= 80) {
      blocks.push({ kind: "subheading", text: line.slice(0, -1).trim() });
    } else if (line.length <= 60 && !/[.!?]$/.test(line)) {
      blocks.push({ kind: "heading", text: line });
    } else {
      blocks.push({ kind: "text", text: line });
    }
  }
  return blocks.filter(x => x.kind === "point").length >= MIN_POINTS ? blocks : null;
}

/** "Topic: detail" → bold topic and detail. Only a short topic (≤ 6 words,
 *  no full stop) counts — otherwise the whole point is the detail. */
export function splitTopic(text: string): { topic: string | null; detail: string } {
  const i = text.indexOf(":");
  if (i <= 0) return { topic: null, detail: text };
  const topic = text.slice(0, i).trim();
  const detail = text.slice(i + 1).trim();
  if (!detail || topic.split(/\s+/).length > 6 || /[.!?]/.test(topic) || /^\d/.test(detail) && /\d$/.test(topic)) return { topic: null, detail: text };
  return { topic, detail };
}

/** How many points, and how many ticked. */
export function tickProgress(blocks: TalkingBlock[], ticked: ReadonlySet<string>): { done: number; total: number } {
  const points = blocks.filter((x): x is Extract<TalkingBlock, { kind: "point" }> => x.kind === "point");
  return { done: points.filter(p => ticked.has(p.key)).length, total: points.length };
}
