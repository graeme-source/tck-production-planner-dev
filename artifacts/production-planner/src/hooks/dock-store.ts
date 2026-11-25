/**
 * The docked panel's shared state: open or shut, a team list or My to-dos,
 * and which page of the to-dos. One small store, so the Layout (which draws
 * the panel), the quick actions, the Create Plan button, the 8am review and
 * every "Open" on a to-do all move the same panel. Remembered per device and
 * per person in localStorage. Rules: lib/team-list-dock.ts and
 * lib/todo-dock.ts. React side: hooks/use-team-list-dock.ts. Objective G.
 *
 * Kept free of React contexts so the auth provider can clear it when the
 * person changes or the PIN pad comes up.
 */
import {
  CLOSED_DOCK, LEGACY_PLAN_LIST_KEY, dockStorageKey, parseLegacyListId, parseStoredDock, serializeDock, type StoredDock,
} from "@/lib/team-list-dock";
import { ownListOnly, placeFromMemory, todoIdToRemember, type TodoDockPlace } from "@/lib/todo-dock";

export interface DockState extends Omit<StoredDock, "todoId">, TodoDockPlace {
  /** Opened on this page load (not just restored from storage). A phone's
   *  full-screen sheet only shows then — a reload never greets you with it. */
  openedNow: boolean;
}

const cache = new Map<string, DockState>();
const listeners = new Set<() => void>();
const CLOSED_STATE: DockState = stateFrom(CLOSED_DOCK);

function stateFrom(s: StoredDock): DockState {
  return { open: s.open, view: s.view, listId: s.listId, ...placeFromMemory(s.todoId), openedNow: false };
}

export function readDock(userId: number | null): DockState {
  if (userId == null) return CLOSED_STATE;
  const key = dockStorageKey(userId);
  const hit = cache.get(key);
  if (hit) return hit;
  let stored = CLOSED_DOCK;
  try {
    stored = parseStoredDock(localStorage.getItem(key));
    if (stored.listId == null) stored = { ...stored, listId: parseLegacyListId(localStorage.getItem(LEGACY_PLAN_LIST_KEY)) };
  } catch { /* private mode: starts shut */ }
  const state = stateFrom(stored);
  cache.set(key, state);
  return state;
}

export function writeDock(userId: number, next: DockState): void {
  const key = dockStorageKey(userId);
  cache.set(key, next);
  try {
    localStorage.setItem(key, serializeDock({ open: next.open, view: next.view, listId: next.listId, todoId: todoIdToRemember(next) }));
  } catch { /* per-device nicety only */ }
  notify();
}

export function subscribeDock(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function notify() {
  listeners.forEach(l => l());
}

/** Someone signed out, or a different person took over: what's in memory
 *  goes. The next person (or the same one) starts from what their own device
 *  memory says, which only ever holds their own list. */
export function forgetDockSession(): void {
  cache.clear();
  fullTodos = false;
  notify();
}

/** The PIN pad is up: a manager who was looking at someone else's list comes
 *  back to their own. */
export function returnDockToOwnList(): void {
  for (const [key, s] of cache) {
    const own = ownListOnly(s);
    if (own !== s) cache.set(key, own);
  }
  notify();
}

// ── Is there somewhere to dock? ────────────────────────────────────────────
// The panel lives in the Layout. A station screen (and anything else drawn
// outside it) has nowhere to put it, so My to-dos there keeps the full-screen
// sheet. Counted, not a boolean: one Layout may mount before another goes.

let hosts = 0;

export function addDockHost(): () => void {
  hosts++;
  notify();
  return () => { hosts--; notify(); };
}

export function dockHostPresent(): boolean {
  return hosts > 0;
}

// ── The full-screen to-do list ─────────────────────────────────────────────
// The panel's "Full view", the Employee Hub's, and station screens' My
// to-dos. Never remembered.

let fullTodos = false;

export function fullTodosOpen(): boolean {
  return fullTodos;
}

export function setFullTodos(open: boolean): void {
  if (fullTodos === open) return;
  fullTodos = open;
  notify();
}
