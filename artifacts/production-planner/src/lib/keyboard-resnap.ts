/**
 * iPad Safari can leave a bottom-pinned bar stuck where the top of the
 * on-screen keyboard was, after the keyboard closes (#382: the Build Queue bar
 * sat over the Part Batch Calculator button). These rules decide when the
 * dock should nudge the page so it drops back to the bottom.
 */

/** The visible area has to grow by this much to count as a keyboard closing,
 *  so Safari's address bar showing or hiding doesn't trigger it. */
export const KEYBOARD_MIN_HEIGHT_PX = 120;

export function keyboardClosed(previousHeight: number, nextHeight: number): boolean {
  return nextHeight - previousHeight >= KEYBOARD_MIN_HEIGHT_PX;
}

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "radio", "submit", "reset", "file", "color", "range"]);

/** Would tapping this element have opened the on-screen keyboard? */
export function opensKeyboard(el: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  return tag === "INPUT" && !NON_TEXT_INPUTS.has((el.type ?? "text").toLowerCase());
}
