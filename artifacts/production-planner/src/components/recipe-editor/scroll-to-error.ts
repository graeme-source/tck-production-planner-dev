/** The save button lives in the pinned footer, so a validation message can
 *  be scrolled out of sight. After a refused save, bring the first one into
 *  view inside the editor body. Used as react-hook-form's onInvalid. */
export function scrollToFirstError(): void {
  if (typeof document === "undefined") return;
  // Let react-hook-form render the messages first.
  setTimeout(() => {
    const body = document.querySelector('[data-testid="editor-body"]');
    const first = body?.querySelector("form span.text-destructive, form [aria-invalid='true']");
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 50);
}
