// Bold in improvement notes (fix-queue #355, Graeme 2026-11-02: "we could
// just add a bold button"). Notes stay plain text in the database; bold is
// written as **marks** around the words. This file is the one place that
// knows the rule — the B button uses wrapBold, every display uses parseBold
// (through components/bold-text.tsx), so they can't drift apart.
//
// Pure functions only: no React, no DOM.

export interface BoldSegment {
  text: string;
  bold: boolean;
}

const MARK = "**";

/**
 * Split text into plain and bold runs. A bold run is `**words**` on a single
 * line with something between the marks. Anything that doesn't pair up (a
 * lone `**`, `****`, marks split across lines) is left exactly as typed.
 * Joining every segment's text with the marks of bold runs put back gives the
 * original text.
 */
export function parseBold(text: string): BoldSegment[] {
  if (!text) return [];
  const out: BoldSegment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf(MARK, i);
    if (open === -1) break;
    const close = text.indexOf(MARK, open + MARK.length);
    if (close === -1) break;
    const inner = text.slice(open + MARK.length, close);
    if (inner.length === 0 || inner.includes("\n")) {
      // Not a bold run: keep the opening mark as text and look again just
      // after it, so "** a **b**" still finds the later pair.
      plain += text.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    plain += text.slice(i, open);
    if (plain) out.push({ text: plain, bold: false });
    plain = "";
    out.push({ text: inner, bold: true });
    i = close + MARK.length;
  }
  plain += text.slice(i);
  if (plain) out.push({ text: plain, bold: false });
  return out;
}

/** True when the text has at least one bold run (plain notes skip all work). */
export function hasBold(text: string | null | undefined): boolean {
  return !!text && parseBold(text).some(s => s.bold);
}

export interface WrapResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Wrap the selected text in bold marks and return the new value plus where
 * the selection should sit afterwards (still around the same words).
 *  - Nothing selected: inserts `****` with the cursor in the middle, so
 *    whatever is typed next is bold.
 *  - Spaces at the edges of the selection stay outside the marks (an iPad
 *    double-tap can grab a trailing space, and `**word **` wouldn't read as
 *    bold).
 */
export function wrapBold(value: string, start: number, end: number): WrapResult {
  const len = value.length;
  let s = Math.max(0, Math.min(start, len));
  let e = Math.max(0, Math.min(end, len));
  if (e < s) [s, e] = [e, s];
  while (s < e && /\s/.test(value[s])) s++;
  while (e > s && /\s/.test(value[e - 1])) e--;
  const before = value.slice(0, s);
  const selected = value.slice(s, e);
  const after = value.slice(e);
  const next = `${before}${MARK}${selected}${MARK}${after}`;
  const innerStart = s + MARK.length;
  return { value: next, selectionStart: innerStart, selectionEnd: innerStart + selected.length };
}
