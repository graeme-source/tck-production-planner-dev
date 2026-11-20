/**
 * Splits a lesson's slide text (what_to_show_md) into what the slide shows
 * big (Graeme, 20 Nov 2026: "I just want the bullet points, the main message
 * in big text, and then a video if there is one"). The bold first line
 * repeats the lesson title, so it's dropped; the "**Today:**" line is the
 * main message.
 */
export interface LessonSlideParts {
  bullets: string[];
  /** "Today", "Today's question"… — shown small above the message. */
  messageLabel: string | null;
  message: string | null;
  /** Anything else (a stray paragraph): shown as a bullet, never lost. */
  other: string[];
  /** A markdown table some older lessons carry, kept whole. */
  tableMd: string | null;
}

const BULLET = /^[-•*]\s+/;
const MESSAGE = /^\*\*([^*:]{1,40}):\*\*\s*(.*)$|^\*\*([^*:]{1,40}):\s*\*\*\s*(.*)$/;
const BOLD_ONLY = /^\*\*[^*]+\*\*$/;

export function lessonSlideParts(md: string | null | undefined): LessonSlideParts {
  const parts: LessonSlideParts = { bullets: [], messageLabel: null, message: null, other: [], tableMd: null };
  const table: string[] = [];
  const lines = (md ?? "").split("\n").map(l => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    if (line.startsWith("|")) { table.push(line); return; }
    if (BULLET.test(line)) { parts.bullets.push(line.replace(BULLET, "")); return; }
    const m = MESSAGE.exec(line);
    if (m && parts.message === null) {
      parts.messageLabel = (m[1] ?? m[3]).trim();
      parts.message = (m[2] ?? m[4]).trim() || null;
      return;
    }
    if (i === 0 && BOLD_ONLY.test(line)) return; // the heading = the title
    parts.other.push(line);
  });
  if (table.length >= 2) parts.tableMd = table.join("\n");
  else parts.other.push(...table);
  return parts;
}
