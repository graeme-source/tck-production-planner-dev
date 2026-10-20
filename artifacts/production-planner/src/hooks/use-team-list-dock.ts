/**
 * The team list dock's state — open or shut, and which list — shared by the
 * Layout (which draws the dock), the quick-actions panel and the Create Plan
 * button (which open it). Remembered per device and per person in
 * localStorage, so it stays open while moving between pages and after a
 * reload. Rules: lib/team-list-dock.ts. Objective G.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
  CLOSED_DOCK, LEGACY_PLAN_LIST_KEY, dockLayout, dockStorageKey, parseLegacyListId, parseStoredDock, serializeDock,
  type DockLayout, type StoredDock,
} from "@/lib/team-list-dock";

interface DockState extends StoredDock {
  /** Opened on this page load (not just restored from storage). A phone's
   *  full-screen sheet only shows then — a reload never greets you with it. */
  openedNow: boolean;
}

const cache = new Map<string, DockState>();
const listeners = new Set<() => void>();
const CLOSED_STATE: DockState = { ...CLOSED_DOCK, openedNow: false };

function read(userId: number | null): DockState {
  if (userId == null) return CLOSED_STATE;
  const key = dockStorageKey(userId);
  const hit = cache.get(key);
  if (hit) return hit;
  let stored = CLOSED_DOCK;
  try {
    stored = parseStoredDock(localStorage.getItem(key));
    if (stored.listId == null) stored = { ...stored, listId: parseLegacyListId(localStorage.getItem(LEGACY_PLAN_LIST_KEY)) };
  } catch { /* private mode: starts shut */ }
  const state = { ...stored, openedNow: false };
  cache.set(key, state);
  return state;
}

function write(userId: number, next: DockState) {
  const key = dockStorageKey(userId);
  cache.set(key, next);
  try { localStorage.setItem(key, serializeDock(next)); } catch { /* per-device nicety only */ }
  listeners.forEach(l => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useTeamListDock() {
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : null;
  const dock = useSyncExternalStore(subscribe, () => read(userId));

  /** Open the dock, on this list (or the one it last showed). */
  const openDock = useCallback((listId?: number | null) => {
    if (userId == null) return;
    const cur = read(userId);
    write(userId, { open: true, listId: listId ?? cur.listId, openedNow: true });
  }, [userId]);
  const closeDock = useCallback(() => {
    if (userId == null) return;
    write(userId, { ...read(userId), open: false, openedNow: false });
  }, [userId]);
  const toggleDock = useCallback((listId?: number | null) => {
    if (userId == null) return;
    const cur = read(userId);
    if (cur.open && (listId == null || listId === cur.listId)) write(userId, { ...cur, open: false, openedNow: false });
    else write(userId, { open: true, listId: listId ?? cur.listId, openedNow: true });
  }, [userId]);
  const setList = useCallback((listId: number) => {
    if (userId == null) return;
    write(userId, { ...read(userId), listId });
  }, [userId]);

  return { ...dock, openDock, closeDock, toggleDock, setList };
}

export function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

export function useDockLayout(): DockLayout {
  return dockLayout(useViewportWidth());
}
