/**
 * The docked panel (Graeme, 2026-10-20; Objective G): "a vertical right-hand
 * panel that resizes the main window and creates a small usable checklist on
 * the right-hand side — a bit like the navigation menu on the left — so we
 * can work and tick things off while we're going, on any page." It shows a
 * team list or, since 25 Nov 2026, My to-dos — one panel, one at a time, with
 * a switcher at the top.
 *
 *   - LayoutTeamListDock: in the Layout, a column beside the page (the page
 *     narrows to make room, it isn't covered). 360 px on a desktop, 320 px at
 *     iPad width; under 768 px there's no room, so it's a full-width sheet
 *     with an X. Stays open across pages and reloads (per device + person).
 *   - TeamListDialogDock: the same panel inside the Create Plan dialog — a
 *     column beside the plan on a desktop, sliding over the right of the
 *     dialog on an iPad (the plan's two panes need the width there).
 *   - What it shows: a team list in compact form (ListDetail compact), or the
 *     to-dos (components/todos/todo-panel.tsx). Same queries and ticks as the
 *     full pages, so they, the quick-actions counts and the panel all agree.
 *
 * Opened from the quick-actions panel (My to-dos, Team lists), the Create
 * Plan screen's amber list button, and everything that opens a to-do. Never
 * on a station screen. Rules (widths, breakpoints, stored state):
 * lib/team-list-dock.ts, lib/todo-dock.ts.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ExternalLink, ListChecks, Maximize2 } from "lucide-react";
import { TodoDockPanel } from "@/components/todos/todo-panel";
import { useAuth } from "@/contexts/auth-context";
import { addDockHost } from "@/hooks/dock-store";
import { cn } from "@/lib/utils";
import { dialogDockMode, dockChoices, resolveDockListId, TODOS_CHOICE, type DockChoice } from "@/lib/team-list-dock";
import { TODO_LIST_PAGE } from "@/lib/todo-dock";
import { useDockLayout, useFullTodos, useTeamListDock, useViewportWidth } from "@/hooks/use-team-list-dock";
import { useVisibleTeamLists } from "./team-lists-dashboard";
import { DockHeader, dockFullViewClass } from "./dock-header";
import { ListDetail } from "@/pages/team-lists";
import type { TeamListSummary } from "./team-lists-api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
/** Added into --right-dock-w (index.css), which the toasts, the quick-actions
 *  tab and the improvement pop-up read to sit left of the dock. */
const DOCK_WIDTH_VAR = "--team-dock-w";

/** The lists the dock can show and the one it's showing (null = hide). */
function useDockList() {
  const dock = useTeamListDock();
  const { data } = useVisibleTeamLists();
  const lists = (data?.lists ?? []).filter(l => !l.archived);
  const listId = resolveDockListId(dock.listId, lists);
  const current = lists.find(l => l.id === listId) ?? null;
  return { dock, lists, current };
}

/** Where the panel is drawn: beside the page, over a phone's whole screen,
 *  or inside the Create Plan dialog. */
type DockPlace = "page" | "sheet" | "dialog";

/** What the panel is showing now — its name and its contents — or null when
 *  there's nothing to show (shut, or a team list that's gone). */
function useDockContents(place: DockPlace): { name: string; panel: ReactNode } | null {
  const { dock, lists, current } = useDockList();
  const { openFull } = useFullTodos();
  if (!dock.open) return null;
  const onSwitch = (choice: DockChoice["value"]) => { if (choice === TODOS_CHOICE) dock.showTodos(); else dock.setList(choice); };

  if (dock.view === "todos") {
    const fullView = place === "page" ? (
      <button type="button" onClick={openFull} className={dockFullViewClass}><Maximize2 className="w-4 h-4" /> Full view</button>
    ) : place === "dialog" ? (
      <a href={`${BASE}/hub?section=todos`} target="_blank" rel="noreferrer" className={dockFullViewClass}
        title="Opens My to-dos in a new tab, so this plan stays open">
        <ExternalLink className="w-4 h-4" /> Full view
      </a>
    ) : undefined; // a phone's sheet is already the whole screen
    return {
      name: "My to-dos",
      panel: (
        <TodoDockPanel choices={dockChoices(TODOS_CHOICE, lists)} onSwitch={onSwitch} onClose={dock.closeDock} fullView={fullView}
          links={place === "dialog" ? "tab" : "app"} sheet={place === "sheet"} />
      ),
    };
  }

  if (!current) return null;
  return {
    name: `Team list: ${current.name}`,
    panel: <TeamListPanel current={current} lists={lists} place={place} onSwitch={onSwitch} onClose={dock.closeDock} />,
  };
}

function TeamListPanel({ current, lists, place, onSwitch, onClose }: {
  current: TeamListSummary;
  lists: TeamListSummary[];
  place: DockPlace;
  onSwitch: (choice: DockChoice["value"]) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0 bg-card">
      <DockHeader
        icon={<span className="text-2xl leading-none pt-1" aria-hidden="true">{current.emoji || "📋"}</span>}
        title={current.name} color={current.color} choices={dockChoices(current.id, lists)} onSwitch={onSwitch}
        onClose={onClose} closeLabel="Close team list"
        fullView={place === "dialog" ? (
          // A new tab, so the plan being made isn't left behind.
          <a href={`${BASE}/lists/${current.id}`} target="_blank" rel="noreferrer" className={dockFullViewClass} title="Opens the full list in a new tab, so this plan stays open">
            <ExternalLink className="w-4 h-4" /> Full view
          </a>
        ) : (
          <Link href={`/lists/${current.id}`} onClick={onClose} className={dockFullViewClass}>
            <Maximize2 className="w-4 h-4" /> Full view
          </Link>
        )}
      />
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3" data-no-swipe="">
        <ListDetail key={current.id} id={current.id} compact />
      </div>
    </div>
  );
}

/** The dock in the app Layout. Renders nothing while shut, on a station
 *  screen, or for someone with nothing to show. */
export function LayoutTeamListDock() {
  const dock = useTeamListDock();
  const layout = useDockLayout();
  const [location] = useLocation();
  const { pinLocked } = useAuth();
  const onStation = /\/station\//.test(location);
  const contents = useDockContents(layout.mode === "sheet" ? "sheet" : "page");
  // A phone's sheet only appears when opened on this visit — never on reload.
  const showing = !!contents && !onStation && (layout.mode === "dock" || dock.openedNow);
  const docked = showing && layout.mode === "dock";
  const dockWidth = docked ? layout.width : null;

  // "There's somewhere to dock here" — My to-dos uses it (use-team-list-dock).
  useEffect(() => (onStation ? undefined : addDockHost()), [onStation]);

  // Shift the fixed bits (toasts, quick-actions tab) left of the dock.
  useEffect(() => {
    const root = document.documentElement;
    if (dockWidth != null) root.style.setProperty(DOCK_WIDTH_VAR, `${dockWidth}px`);
    else root.style.removeProperty(DOCK_WIDTH_VAR);
    return () => { root.style.removeProperty(DOCK_WIDTH_VAR); };
  }, [dockWidth]);

  // As a sheet it covers the page, so going to another page puts it away.
  const lastLocation = useRef(location);
  const { closeDock, setTodoPage } = dock;
  useEffect(() => {
    if (lastLocation.current === location) return;
    lastLocation.current = location;
    if (showing && layout.mode === "sheet") closeDock();
  }, [location, showing, layout.mode, closeDock]);

  // Escape on a sheet: back to the list from a to-do, otherwise away. Beside
  // the page it does nothing — only the X closes it.
  const onTodoPage = dock.view === "todos" && dock.page.kind !== "list";
  useEffect(() => {
    if (!showing || layout.mode !== "sheet") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (onTodoPage) setTodoPage(TODO_LIST_PAGE);
      else closeDock();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showing, layout.mode, onTodoPage, closeDock, setTodoPage]);

  if (!showing || !contents) return null;
  // Under the PIN pad the panel keeps its place but shows nothing: someone's
  // to-dos mustn't be readable through the pad's edges.
  const hidden = pinLocked && "invisible";
  if (layout.mode === "sheet") {
    return (
      <div className={cn("fixed inset-0 z-[60] flex flex-col bg-card", hidden)} role="dialog" aria-modal="true" aria-label={contents.name}
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {contents.panel}
      </div>
    );
  }
  return (
    <aside className={cn("flex-shrink-0 h-full min-h-0 border-l-2 border-border shadow-[-4px_0_12px_-8px_rgba(0,0,0,0.25)] relative z-[5]", hidden)}
      style={{ width: layout.width }} aria-label={contents.name} data-testid="team-list-dock">
      {contents.panel}
    </aside>
  );
}

/** The dock inside the Create Plan dialog: drop it in as the last child of
 *  the dialog's body row (a `relative` flex row). */
export function TeamListDialogDock() {
  const mode = dialogDockMode(useViewportWidth());
  const { pinLocked } = useAuth();
  const contents = useDockContents("dialog");
  if (!contents) return null;
  const hidden = pinLocked && "invisible";
  if (mode === "column") {
    return (
      <aside className={cn("w-[360px] flex-shrink-0 min-h-0 border-l-2 border-border", hidden)} aria-label={contents.name} data-testid="team-list-dialog-dock">
        {contents.panel}
      </aside>
    );
  }
  return (
    <aside className={cn("absolute inset-y-0 right-0 z-20 w-full max-w-[400px] border-l-2 border-border shadow-2xl", hidden)} aria-label={contents.name} data-testid="team-list-dialog-dock">
      {contents.panel}
    </aside>
  );
}

/** The amber list button on the Create Plan screen: opens (or shuts) the
 *  dock on the list it last showed. */
export function TeamListDockButton({ className }: { className?: string }) {
  const { dock, lists, current } = useDockList();
  if (!current || lists.length === 0) return null;
  const showing = dock.open && dock.view === "list";
  return (
    <button type="button" onClick={() => dock.toggleDock(current.id)} aria-pressed={showing}
      className={cn("min-h-[44px] px-4 py-2 rounded-xl text-white font-bold flex items-center gap-2 shadow text-left",
        showing ? "bg-amber-700 hover:bg-amber-800" : "bg-amber-500 hover:bg-amber-600", className)}>
      <ListChecks className="w-5 h-5 shrink-0" /> {current.emoji ? `${current.emoji} ` : ""}{current.name} list
    </button>
  );
}
