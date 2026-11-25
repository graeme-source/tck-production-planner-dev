/**
 * The docked panel — open or shut, and what it's showing: a team list, or My
 * to-dos (25 Nov 2026) and which page of them. Shared by the Layout (which
 * draws it), the quick-actions panel, the Create Plan button and everything
 * that opens a to-do. Remembered per device and per person, so it stays open
 * while moving between pages and after a reload. The store: dock-store.ts.
 * Rules: lib/team-list-dock.ts, lib/todo-dock.ts. Objective G.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/contexts/auth-context";
import { dockLayout, type DockLayout } from "@/lib/team-list-dock";
import { placeForOpening, placeForPerson, todoPageBack, type TodoPage } from "@/lib/todo-dock";
import { dockHostPresent, fullTodosOpen, readDock, setFullTodos, subscribeDock, writeDock } from "./dock-store";

export function useTeamListDock() {
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : null;
  const dock = useSyncExternalStore(subscribeDock, () => readDock(userId));

  const actions = useMemo(() => {
    const change = (f: (cur: ReturnType<typeof readDock>) => ReturnType<typeof readDock>) => {
      if (userId != null) writeDock(userId, f(readDock(userId)));
    };
    const setPage = (page: TodoPage) => change(cur => ({ ...cur, page }));
    return {
      /** Open the panel on a team list (this one, or the one it last showed). */
      openDock: (listId?: number | null) =>
        change(cur => ({ ...cur, open: true, view: "list", listId: listId ?? cur.listId, openedNow: true })),
      closeDock: () => change(cur => ({ ...cur, open: false, openedNow: false, ...placeForOpening() })),
      /** The Create Plan button: its list, or shut if that's what's showing. */
      toggleDock: (listId?: number | null) => change(cur => (
        cur.open && cur.view === "list" && (listId == null || listId === cur.listId)
          ? { ...cur, open: false, openedNow: false }
          : { ...cur, open: true, view: "list", listId: listId ?? cur.listId, openedNow: true })),
      setList: (listId: number) => change(cur => ({ ...cur, view: "list", listId })),
      /** Open the panel on My to-dos — your own list, on one to-do if named. */
      openTodos: (taskId?: number | null) =>
        change(cur => ({ ...cur, open: true, view: "todos", openedNow: true, ...placeForOpening(taskId) })),
      /** The panel's own switcher: My to-dos, wherever they were left. */
      showTodos: () => change(cur => ({ ...cur, view: "todos" })),
      setTodoPage: setPage,
      todoBack: () => change(cur => ({ ...cur, page: todoPageBack(cur.page) })),
      /** Managers: whose list is showing. Never remembered. */
      setTodoPerson: (id: number) => change(cur => ({ ...cur, ...placeForPerson(id, userId ?? id) })),
    };
  }, [userId]);

  return { ...dock, ...actions };
}

/** Is there somewhere to dock here? False on a station screen. */
export function useDockHost(): boolean {
  return useSyncExternalStore(subscribeDock, dockHostPresent);
}

/** The full-screen to-do list: the panel's "Full view", and station screens. */
export function useFullTodos() {
  const open = useSyncExternalStore(subscribeDock, fullTodosOpen);
  return { open, openFull: useCallback(() => setFullTodos(true), []), closeFull: useCallback(() => setFullTodos(false), []) };
}

/** Open My to-dos (or one to-do): in the docked panel where there is one,
 *  otherwise the full-screen list. A named to-do always needs the panel — the
 *  station strip, the only place without one, has its own sheet. */
export function useOpenMyTodos(): (taskId?: number | null) => void {
  const { openTodos } = useTeamListDock();
  const hasHost = useDockHost();
  return useCallback((taskId?: number | null) => {
    if (hasHost) openTodos(taskId);
    else setFullTodos(true);
  }, [hasHost, openTodos]);
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
