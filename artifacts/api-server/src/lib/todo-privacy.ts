/**
 * To-dos that carry someone's employment record (Graeme, 26 Nov 2026: "make
 * sure no one else can see anyone else's reviews … or anything on their
 * personal employment record"). Managers can open anyone's to-do list, so
 * these stay with the person, whoever set them, and People-access holders:
 *   • return-to-work chases (they name the sick dates) — /return-to-work,
 *     and the HR copy that links to /people/<id>;
 *   • anything linking into a People record (review meetings, HR attention,
 *     meeting-note actions);
 *   • probation reminders (they give the probation end date).
 * Pure, tested. Objective H.
 */
const PRIVATE_MAKERS = new Set(["return to work", "probation reminder"]);

export function isPrivateTodo(t: { url?: string | null; created_by_name?: string | null }): boolean {
  const url = (t.url ?? "").trim().toLowerCase();
  if (/^\/(people|return-to-work)(\/|\?|$)/.test(url)) return true;
  return PRIVATE_MAKERS.has((t.created_by_name ?? "").trim().toLowerCase());
}
