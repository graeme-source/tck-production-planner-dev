/** The save button lives in the pinned footer, so a validation message can
 *  be scrolled out of sight. After a refused save, bring the first one into
 *  view inside the editor body. The tabbed editor (editor-shell) switches to
 *  the tab holding it first; messages on the other, hidden tabs are skipped
 *  here because they can't be scrolled to. */
export function scrollToFirstError(): void {
  if (typeof document === "undefined") return;
  // Let react-hook-form render the messages (and the tab switch) first.
  setTimeout(() => {
    // The newest editor body is the one on top (a sub-recipe opened from a row).
    const bodies = document.querySelectorAll('[data-testid="editor-body"]');
    const body = bodies[bodies.length - 1];
    const all = Array.from(body?.querySelectorAll<HTMLElement>("form span.text-destructive, form [aria-invalid='true']") ?? []);
    const first = all.find(el => el.offsetParent !== null) ?? all[0];
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 50);
}
