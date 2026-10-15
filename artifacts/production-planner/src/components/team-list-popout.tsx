/**
 * A team list popped out beside the Create Plan screen (Graeme, 2026-10-15:
 * "a very obvious production flow manager list button where I can pop out
 * the list when I'm creating the production plans"). A big button opens the
 * list as a panel over the right of the dialog — the full list (tick, add,
 * edit) — without leaving the plan. Which list is chosen once and remembered
 * on this device; it starts on the first list you can open.
 */
import { useEffect, useState } from "react";
import { ListChecks, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTeamLists } from "@/components/team-lists/team-lists-api";
import { ListDetail } from "@/pages/team-lists";

const KEY = "tck_plan_screen_team_list";

function readId(): number | null {
  try { const n = Number(localStorage.getItem(KEY)); return Number.isInteger(n) && n > 0 ? n : null; } catch { return null; }
}

export function TeamListPopoutButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useTeamLists(true);
  const lists = (data?.lists ?? []).filter(l => !l.archived);
  const [listId, setListId] = useState<number | null>(readId);
  useEffect(() => {
    if (lists.length && (listId == null || !lists.some(l => l.id === listId))) setListId(lists[0].id);
  }, [lists, listId]);
  const choose = (id: number) => { setListId(id); try { localStorage.setItem(KEY, String(id)); } catch { /* per-device nicety */ } };
  const current = lists.find(l => l.id === listId) ?? null;
  if (!data?.visible || lists.length === 0) return null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={cn("h-11 px-4 rounded-xl bg-amber-500 text-white font-bold flex items-center gap-2 shadow hover:bg-amber-600", className)}>
        <ListChecks className="w-5 h-5" /> {current ? `${current.emoji ? `${current.emoji} ` : ""}${current.name} list` : "Team list"}
      </button>
      {open && (
        <div className="absolute inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(false)}>
          <aside className="h-full w-full max-w-[620px] bg-background border-l-2 border-border shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}
            role="dialog" aria-label="Team list">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
              <ListChecks className="w-5 h-5 text-amber-600" />
              <select value={listId ?? ""} onChange={e => choose(Number(e.target.value))}
                className="flex-1 min-w-0 h-11 px-3 rounded-xl border-2 border-border bg-card font-semibold" aria-label="Which list">
                {lists.map(l => <option key={l.id} value={l.id}>{l.emoji ? `${l.emoji} ` : ""}{l.name}</option>)}
              </select>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close list" className="w-11 h-11 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {listId != null && <ListDetail id={listId} />}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
