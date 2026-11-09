/**
 * Keeping the packing scanner pointed at the scan box (Graeme, 9 Nov 2026:
 * "it won't scan items" on a local delivery). A barcode scanner types like a
 * keyboard and then presses Enter. If a tap left the focus on a button (the
 * local-delivery box + / − or Print box labels), the digits went nowhere and
 * Enter pressed that button again. Pure, tested.
 */
export interface FocusTarget {
  tagName: string;
  isContentEditable?: boolean;
  type?: string;
}

const TYPING_INPUTS = new Set(["text", "search", "number", "tel", "email", "date", "password", "url", ""]);

/** True when the scan box should take the focus back: nothing is focused, or
 *  only something you can't type into (a button, a link, the page). Never
 *  steals it from a box someone is typing in. */
export function shouldReclaimScanFocus(active: FocusTarget | null | undefined): boolean {
  if (!active) return true;
  const tag = active.tagName.toUpperCase();
  if (active.isContentEditable) return false;
  if (tag === "TEXTAREA" || tag === "SELECT") return false;
  if (tag === "INPUT") return !TYPING_INPUTS.has((active.type ?? "").toLowerCase());
  return true;
}
