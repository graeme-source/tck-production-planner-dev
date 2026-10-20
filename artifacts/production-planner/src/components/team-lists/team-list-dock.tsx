/**
 * The team list dock (Graeme, 2026-10-20; Objective G): "a vertical
 * right-hand panel that resizes the main window and creates a small usable
 * checklist on the right-hand side — a bit like the navigation menu on the
 * left — so we can work and tick things off while we're going, on any page."
 *
 *   - LayoutTeamListDock: in the Layout, a column beside the page (the page
 *     narrows to make room, it isn't covered). 360 px on a desktop, 320 px at
 *     iPad width; under 768 px there's no room, so it's a full-width sheet
 *     with an X. Stays open across pages and reloads (per device + person).
 *   - TeamListDialogDock: the same panel inside the Create Plan dialog — a
 *     column beside the plan on a desktop, sliding over the right of the
 *     dialog on an iPad (the plan's two panes need the width there).
 *   - TeamListDockPanel: what both show — the list's full name, a list
 *     switcher, "Full view", close, and the list itself in compact form
 *     (ListDetail compact: same queries and ticks, so the full page, the
 *     quick-actions counts and the dock all agree).
 *
 * Opened from the quick-actions panel's Team lists, and the Create Plan
 * screen's amber list button. Never on a station screen. Rules (widths,
 * breakpoints, stored state): lib/team-list-dock.ts.
 */
import { useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { ExternalLink, ListChecks, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dialogDockMode, resolveDockListId } from "@/lib/team-list-dock";
import { useDockLayout, useTeamListDock, useViewportWidth } from "@/hooks/use-team-list-dock";
import { useVisibleTeamLists } from "./team-lists-dashboard";
import { ListDetail } from "@/pages/team-lists";
import type { TeamListSummary } from "./team-lists-api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
/** Read by the toasts, the quick-actions tab and the improvement pop-up so
 *  they sit left of the dock instead of on top of it. */
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

export function TeamListDockPanel({ current, lists, onSwitch, onClose, fullView }: {
  current: TeamListSummary;
  lists: TeamListSummary[];
  onSwitch: (id: number) => void;
  onClose: () => void;
  /** "page": go to the list's page (and the caller closes the dock).
   *  "new-tab": open it in a new tab — inside Create Plan, so the plan
   *  being made isn't left behind. */
  fullView: { kind: "page"; onGo: () => void } | { kind: "new-tab" };
}) {
  const others = lists.filter(l => l.id !== current.id);
  const fullCls = "h-11 px-3 rounded-xl border-2 border-border bg-card font-semibold text-sm inline-flex items-center gap-1.5 hover:bg-secondary/60 shrink-0";
  return (
    <div className="flex flex-col h-full min-h-0 bg-card">
      <div className="px-3 pt-3 pb-3 border-b border-border space-y-2 flex-shrink-0"
        style={current.color ? { borderTop: `6px solid ${current.color}` } : undefined}>
        <div className="flex items-start gap-2">
          <span className="text-2xl leading-none pt-1" aria-hidden="true">{current.emoji || "📋"}</span>
          {/* The full name, wrapping — never cut short. */}
          <h2 className="flex-1 min-w-0 font-display font-bold text-lg leading-tight break-words pt-1">{current.name}</h2>
          <button type="button" onClick={onClose} aria-label="Close team list" title="Close"
            className="w-11 h-11 -mt-1 -mr-1 rounded-xl hover:bg-secondary flex items-center justify-center shrink-0">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {others.length > 0 ? (
            <select value="" onChange={e => { const id = Number(e.target.value); if (id) onSwitch(id); }}
              aria-label="Switch to another list"
              className="flex-1 min-w-0 h-11 px-2 rounded-xl border-2 border-border bg-background text-sm font-semibold">
              <option value="" disabled>Switch list…</option>
              {others.map(l => <option key={l.id} value={l.id}>{l.emoji ? `${l.emoji} ` : ""}{l.name}</option>)}
            </select>
          ) : <span className="flex-1" />}
          {fullView.kind === "page" ? (
            <Link href={`/lists/${current.id}`} onClick={fullView.onGo} className={fullCls}>
              <Maximize2 className="w-4 h-4" /> Full view
            </Link>
          ) : (
            <a href={`${BASE}/lists/${current.id}`} target="_blank" rel="noreferrer" className={fullCls} title="Opens the full list in a new tab, so this plan stays open">
              <ExternalLink className="w-4 h-4" /> Full view
            </a>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3" data-no-swipe="">
        <ListDetail key={current.id} id={current.id} compact />
      </div>
    </div>
  );
}

/** The dock in the app Layout. Renders nothing while shut, on a station
 *  screen, or for someone with no lists. */
export function LayoutTeamListDock() {
  const { dock, lists, current } = useDockList();
  const layout = useDockLayout();
  const [location] = useLocation();
  const onStation = /\/station\//.test(location);
  // A phone's sheet only appears when opened on this visit — never on reload.
  const showing = dock.open && !!current && !onStation && (layout.mode === "dock" || dock.openedNow);
  const docked = showing && layout.mode === "dock";
  const dockWidth = docked ? layout.width : null;

  // Shift the fixed bits (toasts, quick-actions tab) left of the dock.
  useEffect(() => {
    const root = document.documentElement;
    if (dockWidth != null) root.style.setProperty(DOCK_WIDTH_VAR, `${dockWidth}px`);
    else root.style.removeProperty(DOCK_WIDTH_VAR);
    return () => { root.style.removeProperty(DOCK_WIDTH_VAR); };
  }, [dockWidth]);

  // As a sheet it covers the page, so going to another page puts it away.
  const lastLocation = useRef(location);
  const { closeDock } = dock;
  useEffect(() => {
    if (lastLocation.current === location) return;
    lastLocation.current = location;
    if (showing && layout.mode === "sheet") closeDock();
  }, [location, showing, layout.mode, closeDock]);

  useEffect(() => {
    if (!showing || layout.mode !== "sheet") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDock(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showing, layout.mode, closeDock]);

  if (!showing || !current) return null;
  const panel = (
    <TeamListDockPanel current={current} lists={lists} onSwitch={dock.setList} onClose={dock.closeDock}
      fullView={{ kind: "page", onGo: dock.closeDock }} />
  );
  if (layout.mode === "sheet") {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-card" role="dialog" aria-modal="true" aria-label={`Team list: ${current.name}`}
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {panel}
      </div>
    );
  }
  return (
    <aside className="flex-shrink-0 h-full min-h-0 border-l-2 border-border shadow-[-4px_0_12px_-8px_rgba(0,0,0,0.25)] relative z-[5]"
      style={{ width: layout.width }} aria-label={`Team list: ${current.name}`} data-testid="team-list-dock">
      {panel}
    </aside>
  );
}

/** The dock inside the Create Plan dialog: drop it in as the last child of
 *  the dialog's body row (a `relative` flex row). */
export function TeamListDialogDock() {
  const { dock, lists, current } = useDockList();
  const mode = dialogDockMode(useViewportWidth());
  if (!dock.open || !current) return null;
  const panel = (
    <TeamListDockPanel current={current} lists={lists} onSwitch={dock.setList} onClose={dock.closeDock} fullView={{ kind: "new-tab" }} />
  );
  if (mode === "column") {
    return (
      <aside className="w-[360px] flex-shrink-0 min-h-0 border-l-2 border-border" aria-label={`Team list: ${current.name}`} data-testid="team-list-dialog-dock">
        {panel}
      </aside>
    );
  }
  return (
    <aside className="absolute inset-y-0 right-0 z-20 w-full max-w-[400px] border-l-2 border-border shadow-2xl" aria-label={`Team list: ${current.name}`} data-testid="team-list-dialog-dock">
      {panel}
    </aside>
  );
}

/** The amber list button on the Create Plan screen: opens (or shuts) the
 *  dock on the list it last showed. */
export function TeamListDockButton({ className }: { className?: string }) {
  const { dock, lists, current } = useDockList();
  if (!current || lists.length === 0) return null;
  return (
    <button type="button" onClick={() => dock.toggleDock(current.id)} aria-pressed={dock.open}
      className={cn("min-h-[44px] px-4 py-2 rounded-xl text-white font-bold flex items-center gap-2 shadow text-left",
        dock.open ? "bg-amber-700 hover:bg-amber-800" : "bg-amber-500 hover:bg-amber-600", className)}>
      <ListChecks className="w-5 h-5 shrink-0" /> {current.emoji ? `${current.emoji} ` : ""}{current.name} list
    </button>
  );
}
