/**
 * The docked panel — the pure rules (Graeme, 2026-10-20; Objective G).
 *
 * A list docked down the right of the app, like the left-hand menu, so it
 * can be ticked off while working on any page: a team list, or (25 Nov 2026)
 * your own to-dos. One panel, one at a time; what the to-dos do inside it is
 * lib/todo-dock.ts. These are the decisions the components make: how wide it is, whether there's room to
 * dock it at all (on a phone it becomes a full-width sheet), how it sits
 * inside the Create Plan dialog, which list it shows, and how its
 * per-device memory is read and written.
 */

/** Below this the dock can't sit beside the page — it becomes a sheet. */
export const DOCK_MIN_VIEWPORT = 768;
/** From here the dock gets its full desktop width. */
export const DOCK_WIDE_VIEWPORT = 1024;
export const DOCK_WIDTH_WIDE = 360;
export const DOCK_WIDTH_NARROW = 320;
/** The Create Plan dialog only makes room for a column at this width;
 *  narrower (iPad), the plan's own two panes need every pixel, so the list
 *  slides over the right of the dialog instead. */
export const DIALOG_COLUMN_MIN_VIEWPORT = 1280;

export type DockLayout =
  | { mode: "dock"; width: number }
  | { mode: "sheet"; width: null };

export function dockLayout(viewportWidth: number): DockLayout {
  if (viewportWidth < DOCK_MIN_VIEWPORT) return { mode: "sheet", width: null };
  return { mode: "dock", width: viewportWidth >= DOCK_WIDE_VIEWPORT ? DOCK_WIDTH_WIDE : DOCK_WIDTH_NARROW };
}

/** How the list sits inside the Create Plan dialog. */
export function dialogDockMode(viewportWidth: number): "column" | "overlay" {
  return viewportWidth >= DIALOG_COLUMN_MIN_VIEWPORT ? "column" : "overlay";
}

/** What the panel is showing: a team list, or My to-dos. */
export type DockView = "list" | "todos";

export interface StoredDock {
  open: boolean;
  view: DockView;
  /** The team list it last showed (kept while it shows the to-dos). */
  listId: number | null;
  /** The to-do it was on — your own list's only (lib/todo-dock.ts). */
  todoId: number | null;
}

export const CLOSED_DOCK: StoredDock = { open: false, view: "list", listId: null, todoId: null };

/** Per device and per person: a shared iPad never greets the next person
 *  with someone else's list open. */
export function dockStorageKey(userId: number | string): string {
  return `tck_team_list_dock:${userId}`;
}

function validId(n: unknown): number | null {
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/** Whatever is in storage — missing, old, hand-edited — comes back as a
 *  usable state, never a crash. */
export function parseStoredDock(raw: string | null | undefined): StoredDock {
  if (!raw) return CLOSED_DOCK;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return CLOSED_DOCK;
    const o = v as Record<string, unknown>;
    const listId = validId(o.listId);
    // Saved before the to-dos came into the panel: no view, so a team list.
    const view: DockView = o.view === "todos" ? "todos" : "list";
    const open = o.open === true && (view === "todos" || listId != null);
    return { open, view, listId, todoId: open && view === "todos" ? validId(o.todoId) : null };
  } catch {
    return CLOSED_DOCK;
  }
}

export function serializeDock(s: StoredDock): string {
  const onTodos = s.open && s.view === "todos";
  return JSON.stringify({ open: s.open, view: s.view, listId: s.listId, todoId: onTodos ? s.todoId : null });
}

/** The old Create Plan pop-out remembered its list under its own key; the
 *  dock picks that up the first time so the button keeps its list. */
export const LEGACY_PLAN_LIST_KEY = "tck_plan_screen_team_list";

export function parseLegacyListId(raw: string | null | undefined): number | null {
  if (!raw) return null;
  return validId(Number(raw));
}

/** The switcher's choice for My to-dos (a team list is its id). */
export const TODOS_CHOICE = "todos" as const;

export interface DockChoice {
  value: typeof TODOS_CHOICE | number;
  label: string;
}

/** Everything else the panel can show: My to-dos first, then the person's
 *  team lists — whatever it's showing now left out. */
export function dockChoices(showing: DockChoice["value"], lists: ReadonlyArray<{ id: number; name: string; emoji?: string | null }>): DockChoice[] {
  const all: DockChoice[] = [
    { value: TODOS_CHOICE, label: "My to-dos" },
    ...lists.map(l => ({ value: l.id, label: `${l.emoji ? `${l.emoji} ` : ""}${l.name}` })),
  ];
  return all.filter(c => c.value !== showing);
}

/** The list to show: the remembered one while this person can still open
 *  it, otherwise their first list, otherwise none. */
export function resolveDockListId(wanted: number | null, lists: ReadonlyArray<{ id: number; archived?: boolean }>): number | null {
  const live = lists.filter(l => !l.archived);
  if (wanted != null && live.some(l => l.id === wanted)) return wanted;
  return live[0]?.id ?? null;
}

/** The app setting naming the team list the Create Plan screen's list button
 *  opens (Graeme, 27 Nov 2026: it showed whatever list was last opened
 *  anywhere — "Marketing" — rather than the production planning list). */
export const CREATE_PLAN_LIST_SETTING = "create_plan_team_list_id";

/** The list the Create Plan screen opens: the one the app setting names,
 *  while this person can still open it, otherwise their first live list by
 *  the lists' own order, otherwise none. Never the last list opened
 *  elsewhere, and never a name match. */
export function createPlanListId(
  setting: string | null | undefined,
  lists: ReadonlyArray<{ id: number; archived?: boolean; sortOrder?: number; name?: string }>,
): number | null {
  const live = lists.filter(l => !l.archived);
  const trimmed = setting?.trim() ?? "";
  const wanted = /^\d+$/.test(trimmed) ? validId(Number(trimmed)) : null;
  if (wanted != null && live.some(l => l.id === wanted)) return wanted;
  const first = [...live].sort((a, b) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.name ?? "").localeCompare(b.name ?? "") || a.id - b.id)[0];
  return first?.id ?? null;
}
