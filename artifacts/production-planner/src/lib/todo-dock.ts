/**
 * My to-dos in the docked panel — the pure rules (Graeme, 25 Nov 2026:
 * "I want to be able to work on the to-do list while I'm working in the
 * app"). Objective G.
 *
 * The panel is the same one as the team lists (lib/team-list-dock.ts). Inside
 * it the to-dos are PAGES, not pop-ups: the list, one to-do, editing it, a
 * new one — each with a Back. These are the decisions: where Back goes, what
 * a reload reopens, and whose list it may be.
 *
 * A to-do list is private. A manager can look at someone else's, but only
 * until they leave it: a reload, the PIN pad or the next sign-in always comes
 * back to the person's OWN list. So someone else's list — and any to-do opened
 * from it — is never written to the device.
 */

/** Which page of the to-dos the panel is on. `restored` = reopened from the
 *  device's memory, not tapped just now (see keepRestoredTask). */
export type TodoPage =
  | { kind: "list" }
  | { kind: "task"; id: number; restored?: boolean }
  | { kind: "edit"; id: number }
  | { kind: "create" };

export const TODO_LIST_PAGE: TodoPage = { kind: "list" };

/** Back: editing goes to its to-do, everything else to the list. */
export function todoPageBack(page: TodoPage): TodoPage {
  return page.kind === "edit" ? { kind: "task", id: page.id } : TODO_LIST_PAGE;
}

/** The to-do being looked at, if the panel is on one. */
export function todoIdOf(page: TodoPage): number | null {
  return page.kind === "task" || page.kind === "edit" ? page.id : null;
}

export interface TodoDockPlace {
  /** Whose list — null is your own. */
  viewUserId: number | null;
  page: TodoPage;
}

export const OWN_TODO_LIST: TodoDockPlace = { viewUserId: null, page: TODO_LIST_PAGE };

/** The to-do a reload may reopen: only one opened from your own list. */
export function todoIdToRemember(p: TodoDockPlace): number | null {
  return p.viewUserId === null ? todoIdOf(p.page) : null;
}

/** Where a reload puts you: your own list, on the to-do you were on. */
export function placeFromMemory(todoId: number | null): TodoDockPlace {
  return { viewUserId: null, page: todoId === null ? TODO_LIST_PAGE : { kind: "task", id: todoId, restored: true } };
}

/** The PIN pad, or a new sign-in: anyone else's list is dropped; your own
 *  stays where it was. */
export function ownListOnly<T extends TodoDockPlace>(p: T): T {
  return p.viewUserId === null ? p : { ...p, ...OWN_TODO_LIST };
}

/** Opening My to-dos: always your own list — on one to-do when it's named. */
export function placeForOpening(taskId?: number | null): TodoDockPlace {
  return { viewUserId: null, page: taskId ? { kind: "task", id: taskId } : TODO_LIST_PAGE };
}

/** Looking at someone's list (managers). Choosing yourself is your own list. */
export function placeForPerson(userId: number, meId: number): TodoDockPlace {
  return { viewUserId: userId === meId ? null : userId, page: TODO_LIST_PAGE };
}

/** A remembered to-do stays open only while it's still there and still on
 *  this person's own list; otherwise the panel shows the list. */
export function keepRestoredTask(task: { assignee_id: number } | null | undefined, meId: number): boolean {
  return !!task && task.assignee_id === meId;
}

/** "My to-dos" / "Lorna Smith's to-dos". */
export function todoListTitle(viewUserId: number | null, name: string | null | undefined): string {
  if (viewUserId === null) return "My to-dos";
  return name ? `${name}'s to-dos` : "Someone else's to-dos";
}
