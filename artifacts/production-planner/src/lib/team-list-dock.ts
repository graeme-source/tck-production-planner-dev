/**
 * The team list dock — the pure rules (Graeme, 2026-10-20; Objective G).
 *
 * A team list docked down the right of the app, like the left-hand menu,
 * so the list can be ticked off while working on any page. These are the
 * decisions the components make: how wide it is, whether there's room to
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

export interface StoredDock {
  open: boolean;
  listId: number | null;
}

export const CLOSED_DOCK: StoredDock = { open: false, listId: null };

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
    return { open: o.open === true && listId != null, listId };
  } catch {
    return CLOSED_DOCK;
  }
}

export function serializeDock(s: StoredDock): string {
  return JSON.stringify({ open: s.open, listId: s.listId });
}

/** The old Create Plan pop-out remembered its list under its own key; the
 *  dock picks that up the first time so the button keeps its list. */
export const LEGACY_PLAN_LIST_KEY = "tck_plan_screen_team_list";

export function parseLegacyListId(raw: string | null | undefined): number | null {
  if (!raw) return null;
  return validId(Number(raw));
}

/** The list to show: the remembered one while this person can still open
 *  it, otherwise their first list, otherwise none. */
export function resolveDockListId(wanted: number | null, lists: ReadonlyArray<{ id: number; archived?: boolean }>): number | null {
  const live = lists.filter(l => !l.archived);
  if (wanted != null && live.some(l => l.id === wanted)) return wanted;
  return live[0]?.id ?? null;
}
