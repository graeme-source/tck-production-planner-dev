/**
 * Team lists on the dashboard and in the quick-actions panel (Graeme,
 * 2026-10-13: "the dashboard is probably the right place"; no new button on
 * every page). Managers and admins only — renders nothing for anyone else,
 * and never fetches for them. Objective G: each list's state at a glance
 * ("Production planner · 3 of 9 done · 1 overdue"), one tap into it.
 */
import { Link } from "wouter";
import { ChevronRight, ListChecks, Plus } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ListCard } from "./list-card";
import { useTeamLists } from "./team-lists-api";

function useIsManager(): boolean {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  return role === "admin" || role === "manager";
}

export function TeamListsDashboardSection() {
  const isManager = useIsManager();
  const { data } = useTeamLists(isManager);
  if (!isManager || !data) return null;
  const lists = data.lists;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Team lists</p>
        <Link href="/lists" className="text-sm font-semibold text-primary inline-flex items-center gap-1 min-h-[36px]">
          All lists <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
      {lists.length === 0 ? (
        <Link href="/lists" className="flex items-center gap-3 rounded-3xl border-2 border-dashed border-border p-5 hover:bg-secondary/40">
          <ListChecks className="w-8 h-8 text-muted-foreground" />
          <span className="flex-1">
            <span className="block font-bold text-lg">Shared team lists</span>
            <span className="block text-sm text-muted-foreground">Recurring routines any manager can pick up — e.g. the Production planner's daily list.</span>
          </span>
          <Plus className="w-6 h-6" />
        </Link>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {lists.map(l => <ListCard key={l.id} list={l} compact />)}
        </div>
      )}
    </div>
  );
}

/** The quick-actions panel's section: same lists, compact. Hidden on
 *  station screens by the caller. */
export function TeamListsPanelSection({ onNavigate }: { onNavigate: () => void }) {
  const isManager = useIsManager();
  const { data } = useTeamLists(isManager);
  if (!isManager || !data || data.lists.length === 0) return null;
  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Team lists</h3>
        <Link href="/lists" onClick={onNavigate} className="text-sm font-semibold text-primary inline-flex items-center gap-1 min-h-[40px]">
          All lists <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.lists.map(l => <ListCard key={l.id} list={l} compact onClick={onNavigate} />)}
      </div>
    </div>
  );
}
