/**
 * Team lists (Graeme, 2026-10-13) — /lists and /lists/:id. Objectives G and F.
 *
 * Shared recurring routines that belong to a role, not a person (the
 * Production Planner's daily list, the Scheduling Manager's weekly one).
 * If the usual person is off, anyone ticked on the list opens it and ticks
 * it as themselves. Access (server-enforced, Graeme 2026-10-14): admins
 * always; anyone else, any role, only when ticked in the list's Settings.
 * Changing the list (tasks, people, archive, import) is for managers and
 * admins with access — everyone else with access just ticks. Never on a
 * station screen. Reached from the dashboard's Team lists card, the
 * quick-actions panel and My To-dos — each shown only to people with access.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, ChevronRight, Clock, ExternalLink, Eye, EyeOff,
  Loader2, Pencil, Plus, Settings2, SkipForward, Undo2, ListChecks, Repeat, Rows3,
} from "lucide-react";
import { describeRule } from "@workspace/recurrence";
import { SmartAddBox } from "@/components/smart-add/smart-add-box";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import {
  COMING_UP_OPEN_KEY, SHOW_DONE_KEY, comingUpOpen, completionLabel, defaultCarryOver, dayHeading, overdueLabel, TEAM_LIST_DEFAULT_SORT, teamTaskSortFields,
  compactRowsKey, compactRowsOn, priorityEdgeClass, todayHeaderLine,
} from "@/lib/team-list-view";
import { sortTasks } from "@/lib/task-sort";
import { TaskSortControl, useTaskSort } from "@/components/task-sort-control";
import {
  PRIORITY_STYLES, progressText, useAddItem, useReorderItems, useTeamList, useTeamLists, useTick,
  type DayEntry, type Progress, type TeamListItem, type TeamListSummary,
} from "@/components/team-lists/team-lists-api";
import { ItemEditModal } from "@/components/team-lists/item-edit-modal";
import { ListSettingsModal } from "@/components/team-lists/list-settings-modal";
import { ListCard, ProgressBar } from "@/components/team-lists/list-card";
import { ImportModal } from "@/components/team-lists/import-modal";

export default function TeamListsPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : null;
  return id && Number.isInteger(id) ? <ListDetail id={id} /> : <ListsIndex />;
}

// ── /lists ─────────────────────────────────────────────────────────────────
function ListsIndex() {
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, error } = useTeamLists(true, showArchived);
  const [creating, setCreating] = useState(false);
  const [, setLocation] = useLocation();
  const lists = data?.lists ?? [];
  const live = lists.filter(l => !l.archived);
  const archived = lists.filter(l => l.archived);

  return (
    <div className="space-y-6 w-full">
      <PageHeader
        title="Team lists"
        description="Shared routines anyone in the team can pick up"
        action={data?.canCreate ? (
          <button onClick={() => setCreating(true)} className="h-12 px-5 bg-primary text-primary-foreground rounded-xl font-semibold flex items-center gap-2">
            <Plus className="w-5 h-5" /> New list
          </button>
        ) : undefined}
      />
      {isLoading && <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading lists…</p>}
      {error && <p className="text-red-600">Couldn't load the lists — {(error as Error).message}</p>}

      {!isLoading && !error && live.length === 0 && !data?.canCreate && (
        <div className="max-w-xl rounded-3xl border-2 border-border bg-card p-8 text-center space-y-2">
          <ListChecks className="w-10 h-10 mx-auto text-muted-foreground" />
          <p className="text-lg font-semibold">You haven't been given any team lists.</p>
          <p className="text-muted-foreground">A manager can tick you on a list in its Settings.</p>
        </div>
      )}

      {!isLoading && !error && live.length === 0 && data?.canCreate && (
        <button onClick={() => setCreating(true)} className="w-full rounded-3xl border-2 border-dashed border-border p-10 text-center hover:bg-secondary/40">
          <ListChecks className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
          <span className="block text-xl font-bold">Create your first team list</span>
          <span className="block text-muted-foreground">e.g. "Production planner" — the daily routine anyone can pick up when someone's off.</span>
        </button>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {live.map(l => <ListCard key={l.id} list={l} />)}
      </div>

      <div>
        <button onClick={() => setShowArchived(s => !s)} className="min-h-[48px] inline-flex items-center gap-2 text-muted-foreground font-semibold">
          {showArchived ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />} Archived lists
        </button>
        {showArchived && (
          archived.length === 0
            ? <p className="text-sm text-muted-foreground pl-7">None.</p>
            : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mt-2 opacity-70">{archived.map(l => <ListCard key={l.id} list={l} />)}</div>
        )}
      </div>

      {creating && <ListSettingsModal list={null} onClose={() => setCreating(false)} onCreated={id => setLocation(`/lists/${id}`)} />}
    </div>
  );
}

// ── /lists/:id ────────────────────────────────────────────────────────────
/** `compact`: the narrow version in the team list dock (Graeme,
 *  2026-10-20) — same data, ticks and add box, smaller rows, no page
 *  header, sort, settings or "All tasks" (those live on the full page). */
export function ListDetail({ id, compact = false }: { id: number; compact?: boolean }) {
  const { data, isLoading, error } = useTeamList(id);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Open by default; closing it is remembered on this device (Graeme, 2026-10-14).
  const [showComing, setShowComing] = useState(() => {
    try { return comingUpOpen(localStorage.getItem(COMING_UP_OPEN_KEY)); } catch { return true; }
  });
  const toggleComing = () => {
    const next = !showComing;
    try { localStorage.setItem(COMING_UP_OPEN_KEY, next ? "1" : "0"); } catch { /* private mode: just this visit */ }
    setShowComing(next);
  };
  const [showAll, setShowAll] = useState(false);
  // Completed tasks hidden by default; the choice is remembered on this
  // device (Graeme, 2026-10-15: "hide completed tasks by default").
  const [showDone, setShowDone] = useState(() => {
    try { return localStorage.getItem(SHOW_DONE_KEY) === "1"; } catch { return false; }
  });
  const toggleDone = () => {
    const next = !showDone;
    try { localStorage.setItem(SHOW_DONE_KEY, next ? "1" : "0"); } catch { /* just this visit */ }
    setShowDone(next);
  };
  // The Compact switch (#330): one-line rows for desk users, remembered
  // per person on this device. Not offered in the dock (already narrow).
  const { state: auth } = useAuth();
  const meId = auth.status === "authenticated" ? auth.user.id : null;
  const [dense, setDense] = useState(false);
  useEffect(() => {
    try { setDense(compactRowsOn(localStorage.getItem(compactRowsKey(meId)))); } catch { /* private mode */ }
  }, [meId]);
  const toggleDense = () => {
    const next = !dense;
    try { localStorage.setItem(compactRowsKey(meId), next ? "1" : "0"); } catch { /* just this visit */ }
    setDense(next);
  };
  // Time, then Priority unless this person picked otherwise for this list.
  const [sort, setSort] = useTaskSort(`team-list-${id}`, TEAM_LIST_DEFAULT_SORT);
  // Adding stays on the list (Graeme, 2026-10-13, same as My To-dos): the
  // new task glows for a moment, and keeps a "Set days" chip for the rest of
  // this visit so its repeat is one tap away — the editor isn't forced open.
  const [justAddedId, setJustAddedId] = useState<number | null>(null);
  const [addedIds, setAddedIds] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    if (justAddedId == null) return;
    const t = setTimeout(() => setJustAddedId(null), 2500);
    return () => clearTimeout(t);
  }, [justAddedId]);
  const onAdded = (itemId: number) => {
    setJustAddedId(itemId);
    setAddedIds(prev => new Set(prev).add(itemId));
  };

  const byId = useMemo(() => new Map((data?.items ?? []).map(i => [i.id, i])), [data]);
  const editing = editingId != null ? byId.get(editingId) ?? null : null;

  if (isLoading) return <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</p>;
  if ((error || !data) && compact) return <p className="text-red-600">{(error as Error | null)?.message ?? "List not found"}</p>;
  if (error || !data) {
    return (
      <div className="space-y-3">
        <PageHeader title="Team list" />
        <p className="text-red-600">{(error as Error | null)?.message ?? "List not found"}</p>
        <Link href="/lists" className="inline-flex items-center gap-2 font-semibold min-h-[48px]"><ArrowLeft className="w-5 h-5" /> All lists</Link>
      </div>
    );
  }

  const { list, entries, progress, today } = data;
  // Overdue keeps its own section; both sections follow the chosen sort.
  const sortEntries = (rows: DayEntry[]) => sortTasks(
    rows.filter(e => byId.has(e.itemId)), sort, e => teamTaskSortFields(byId.get(e.itemId)!, e),
  );
  const visible = (e: DayEntry) => showDone || !e.completion;
  const overdue = sortEntries(entries.filter(e => e.overdue && visible(e)));
  const todays = sortEntries(entries.filter(e => !e.overdue && visible(e)));
  const hiddenDone = entries.filter(e => e.completion).length;
  const todayLabel = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  const row = (e: DayEntry, upcoming = false) => byId.get(e.itemId) && (
    <TaskRow key={`${e.itemId}-${e.dueDate}`} item={byId.get(e.itemId)!} entry={e} today={today} compact={compact} upcoming={upcoming}
      onEdit={list.canEdit ? () => setEditingId(e.itemId) : undefined}
      justAdded={!upcoming && e.itemId === justAddedId} isNew={!upcoming && addedIds.has(e.itemId)} />
  );
  const modals = (
    <>
      {editing && list.canEdit && <ItemEditModal key={editing.id} item={editing} today={today} onClose={() => setEditingId(null)} />}
      {settingsOpen && list.canEdit && <ListSettingsModal list={list} onClose={() => setSettingsOpen(false)} onImport={() => { setSettingsOpen(false); setImportOpen(true); }} />}
      {importOpen && list.canEdit && <ImportModal listId={list.id} onClose={() => setImportOpen(false)} onEditItem={itemId => { setImportOpen(false); setEditingId(itemId); }} />}
    </>
  );
  const emptyText = data.items.length === 0 ? (list.canEdit ? "No tasks yet — add the first one below." : "No tasks yet.") : hiddenDone > 0 && !showDone ? "All done for today 🎉" : "Nothing due today.";

  if (compact) {
    const comingCount = data.comingUp.reduce((n, d) => n + d.itemIds.length, 0);
    return (
      <div className="space-y-4 w-full">
        {list.archived && <p className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm font-semibold">This list is archived.</p>}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-sm font-semibold", progress.overdue > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{progressText(progress)}</span>
            <span className="flex-1" />
            <button type="button" onClick={toggleDone} aria-pressed={showDone}
              className="min-h-[40px] px-3 rounded-xl border-2 border-border bg-card text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-secondary/60">
              {showDone ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
              {showDone ? "Hide done" : `Show done${hiddenDone > 0 ? ` (${hiddenDone})` : ""}`}
            </button>
          </div>
          {progress.total > 0 && <ProgressBar progress={progress} color={list.color} />}
        </div>
        {overdue.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">Overdue</h3>
            {overdue.map(e => row(e))}
          </section>
        )}
        <section className="space-y-2">
          {overdue.length > 0 && <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Today</h3>}
          {todays.length === 0 && overdue.length === 0 && (
            <p className="rounded-xl border-2 border-dashed border-border p-4 text-center text-muted-foreground">{emptyText}</p>
          )}
          {todays.map(e => row(e))}
          {list.canEdit && <AddTask listId={list.id} today={today} onAdded={onAdded} compact />}
        </section>
        {comingCount > 0 && (
          <section className="space-y-2">
            <button type="button" onClick={toggleComing} aria-expanded={showComing} className="w-full min-h-[44px] flex items-center gap-2 text-left">
              {showComing ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <span className="flex-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Coming up this week</span>
              <span className="text-sm text-muted-foreground font-semibold tabular-nums">{comingCount}</span>
            </button>
            {showComing && data.comingUp.map(day => {
              const rows = sortTasks(day.entries.filter(e => byId.has(e.itemId) && (showDone || !e.completion)), sort, e => teamTaskSortFields(byId.get(e.itemId)!));
              if (rows.length === 0) return null;
              return (
                <div key={day.date} className="space-y-2">
                  <h4 className="font-bold text-sm">{dayHeading(day.date, today)}</h4>
                  {rows.map(e => row(e, true))}
                </div>
              );
            })}
          </section>
        )}
        {modals}
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full">
      {/* Title on one line in the top bar (#330): no "Team list" filler. */}
      <PageHeader title={`${list.emoji ? `${list.emoji} ` : ""}${list.name}`} description={list.description ?? undefined} />

      {list.archived && (
        <p className="rounded-2xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 font-semibold">This list is archived — restore it in Settings to use it again.</p>
      )}

      {/* One slim line: back arrow, "Today · Thu 15 Oct · 3 of 10 done",
          then small chips for completed / sort / Compact and a Settings icon
          (Import lives inside Settings), with a thin progress bar under it —
          so at least 10 tasks fit on first load (#330, Jane Miles). */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href="/lists" aria-label="All lists" title="All lists" className="min-h-[44px] min-w-[44px] -ml-2 rounded-xl inline-flex items-center justify-center hover:bg-secondary/60"><ArrowLeft className="w-5 h-5" /></Link>
          <h2 className={cn("font-display text-lg font-bold", progress.overdue > 0 && "text-amber-700 dark:text-amber-400")}>{todayHeaderLine(today, progressText(progress))}</h2>
          <span className="flex-1" />
          <button type="button" onClick={toggleDone} aria-pressed={showDone}
            className="min-h-[40px] px-3 rounded-full border-2 border-border bg-card text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-secondary/60">
            {showDone ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
            {showDone ? "Hide completed" : `Show completed${hiddenDone > 0 ? ` (${hiddenDone})` : ""}`}
          </button>
          <TaskSortControl spec={sort} onChange={setSort} chip />
          <button type="button" role="switch" aria-checked={dense} onClick={toggleDense}
            title="One-line rows, for a desk screen"
            className={cn("min-h-[40px] px-3 rounded-full border-2 text-sm font-semibold inline-flex items-center gap-1.5",
              dense ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-secondary/60")}>
            <Rows3 className="w-4 h-4" /> Compact{dense ? ": on" : ""}
          </button>
          {list.canEdit && (
            <button type="button" onClick={() => setSettingsOpen(true)} aria-label="List settings" title="Settings"
              className="w-11 h-11 rounded-xl border-2 border-border bg-card inline-flex items-center justify-center hover:bg-secondary/60">
              <Settings2 className="w-5 h-5 text-muted-foreground" />
            </button>
          )}
        </div>
        {progress.total > 0 && <ProgressBar progress={progress} color={list.color} thin />}
      </div>

      {overdue.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">Overdue</h3>
          {overdue.map(e => byId.get(e.itemId) && <TaskRow key={`${e.itemId}-${e.dueDate}`} item={byId.get(e.itemId)!} entry={e} today={today} dense={dense} onEdit={list.canEdit ? () => setEditingId(e.itemId) : undefined} justAdded={e.itemId === justAddedId} isNew={addedIds.has(e.itemId)} />)}
        </section>
      )}

      <section className="space-y-3">
        {overdue.length > 0 && <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Today</h3>}
        {todays.length === 0 && overdue.length === 0 && (
          <p className="rounded-2xl border-2 border-dashed border-border p-6 text-center text-muted-foreground text-lg">
            {emptyText}
          </p>
        )}
        {todays.map(e => byId.get(e.itemId) && <TaskRow key={`${e.itemId}-${e.dueDate}`} item={byId.get(e.itemId)!} entry={e} today={today} dense={dense} onEdit={list.canEdit ? () => setEditingId(e.itemId) : undefined} justAdded={e.itemId === justAddedId} isNew={addedIds.has(e.itemId)} />)}
        {list.canEdit && <AddTask listId={list.id} today={today} onAdded={onAdded} />}
      </section>

      {/* Open by default, grouped by day. Anything here can be ticked early
          (Graeme, 2026-10-14) — it's recorded against its own day, so it
          shows as done when that day comes and counts in that day's progress. */}
      <Collapsible open={showComing} onToggle={toggleComing} title="Coming up this week"
        count={data.comingUp.reduce((n, d) => n + d.itemIds.length, 0)}
        hint={data.comingUp.length > 0 ? "Done one already? Tick it off early." : undefined}>
        {data.comingUp.length === 0 ? <p className="text-muted-foreground">Nothing else in the next seven days.</p> : (
          <div className="space-y-5">
            {data.comingUp.map(day => (
              <div key={day.date} className="space-y-3">
                <h3 className="font-bold text-lg">{dayHeading(day.date, today)}</h3>
                {sortTasks(day.entries.filter(e => byId.has(e.itemId) && (showDone || !e.completion)), sort, e => teamTaskSortFields(byId.get(e.itemId)!)).map(e => (
                  <TaskRow key={`${e.itemId}-${e.dueDate}`} item={byId.get(e.itemId)!} entry={e} today={today} upcoming dense={dense}
                    onEdit={list.canEdit ? () => setEditingId(e.itemId) : undefined} />
                ))}
              </div>
            ))}
          </div>
        )}
      </Collapsible>

      <Collapsible open={showAll} onToggle={() => setShowAll(s => !s)} title="All tasks" count={data.items.length}>
        <AllTasks listId={list.id} items={data.items} onEdit={list.canEdit ? setEditingId : undefined} />
      </Collapsible>

      {modals}
    </div>
  );
}

function Collapsible({ open, onToggle, title, count, hint, children }: { open: boolean; onToggle: () => void; title: string; count: number; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border-2 border-border bg-card">
      <button onClick={onToggle} aria-expanded={open} className="w-full min-h-[60px] px-5 flex items-center gap-3 text-left">
        {open ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        <span className="flex-1">
          <span className="block text-lg font-bold">{title}</span>
          {hint && open && <span className="block text-sm text-muted-foreground">{hint}</span>}
        </span>
        <span className="text-muted-foreground font-semibold tabular-nums">{count}</span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}

/** The task's title — a link when the task has one ("anything the UI
 *  names, it links"): pages in the app in place, websites in a new tab. */
function TaskTitle({ item, done, compact = false }: { item: TeamListItem; done: boolean; compact?: boolean }) {
  const cls = cn(compact ? "text-base" : "text-lg", "font-semibold leading-snug break-words", done && "line-through text-muted-foreground");
  if (!item.url) return <span className={cls}>{item.title}</span>;
  if (item.url.startsWith("/")) return <Link href={item.url} className={cn(cls, "underline decoration-2 underline-offset-4 text-primary")}>{item.title}</Link>;
  return (
    <a href={item.url} target="_blank" rel="noreferrer" className={cn(cls, "underline decoration-2 underline-offset-4 text-primary inline-flex items-center gap-1")}>
      {item.title} <ExternalLink className="w-4 h-4" />
    </a>
  );
}

function TaskRow({ item, entry, today, onEdit, justAdded = false, isNew = false, upcoming = false, compact = false, dense = false }: {
  item: TeamListItem; entry: DayEntry; today: string;
  /** The dock's narrow row: smaller tick, icon-only Skip/Undo. */
  compact?: boolean;
  /** The Compact switch on the full page (#330): one-line rows for a desk. */
  dense?: boolean;
  /** In Coming up: ticking it now is ticking it early, for entry.dueDate. */
  upcoming?: boolean;
  /** Absent for people who can tick but not change the list. */
  onEdit?: () => void;
  /** Glows for a moment after being added. */
  justAdded?: boolean;
  /** Added this visit: offer "Set days" (it was created as every day). */
  isNew?: boolean;
}) {
  const tick = useTick();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (justAdded) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [justAdded]);
  const c = entry.completion;
  const run = (args: { status?: "done" | "skipped"; undo?: boolean }) =>
    tick.mutate({ itemId: item.id, dueDate: entry.dueDate, ...args }, {
      onError: err => toast({ title: "Didn't save", description: (err as Error).message, variant: "destructive" }),
    });

  const pri = item.priority < 4 ? PRIORITY_STYLES[item.priority].label : null;
  const meta = (
    <>
      {justAdded && <span className="font-bold text-primary">Just added</span>}
      {isNew && !c && onEdit && (
        <button type="button" onClick={onEdit}
          className="min-h-[36px] px-3 rounded-full border-2 border-primary/40 text-primary font-semibold inline-flex items-center gap-1 hover:bg-primary/10">
          <Repeat className="w-4 h-4" /> {describeRule(item.recurrence)} · Set days
        </button>
      )}
      {/* Priority is the row's coloured left edge now, not a chip (#330). */}
      {pri && <span className="sr-only">Priority {pri}</span>}
      {item.timeOfDay && <span className="inline-flex items-center gap-1"><Clock className="w-4 h-4" />{item.timeOfDay}</span>}
      {entry.overdue && !c && <span className="font-semibold text-amber-700 dark:text-amber-400">{overdueLabel(entry.dueDate, today)}</span>}
      {c && <span className={c.status === "done" ? "text-emerald-700 dark:text-emerald-400" : ""}>{completionLabel(c, entry.dueDate, today)}</span>}
    </>
  );

  return (
    <div ref={ref} data-just-added={justAdded ? "true" : undefined}
      title={pri ? `Priority ${pri}` : undefined}
      className={cn("rounded-2xl border-2 bg-card flex transition-all duration-500",
        dense ? "items-center px-2 py-1 gap-2 scroll-mb-28" : compact ? "items-start p-2 gap-2 scroll-mb-8" : "items-start p-2 sm:p-2.5 gap-3 scroll-mb-28",
        justAdded ? "border-primary ring-4 ring-primary/30 bg-primary/5" : entry.overdue && !c ? "border-amber-300 dark:border-amber-700" : "border-border",
        !c && priorityEdgeClass(item.priority) && cn("border-l-[6px]", priorityEdgeClass(item.priority)),
        c && "bg-muted/40")}>
      <button
        type="button"
        onClick={() => run(c ? { undo: true } : { status: "done" })}
        disabled={tick.isPending}
        aria-label={c ? `Undo ${item.title}` : upcoming ? `Mark ${item.title} done early` : `Mark ${item.title} done`}
        className={cn("rounded-full flex items-center justify-center shrink-0 transition-colors", dense ? "w-9 h-9 border-[3px]" : "w-11 h-11 border-[3px]",
          c?.status === "done" ? "bg-emerald-500 border-emerald-500 text-white" : c?.status === "skipped" ? "bg-muted border-muted-foreground/40 text-muted-foreground" : PRIORITY_STYLES[item.priority].ring)}
      >
        {tick.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : c?.status === "done" ? <Check className={dense ? "w-5 h-5" : "w-6 h-6"} /> : c?.status === "skipped" ? <SkipForward className="w-5 h-5" /> : null}
      </button>
      {dense ? (
        <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <TaskTitle item={item} done={!!c} compact />
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">{meta}</span>
          {tick.error && <span className="text-sm text-red-600">{(tick.error as Error).message}</span>}
        </div>
      ) : (
      <div className={cn("min-w-0 flex-1 space-y-0.5", compact ? "pt-0.5" : "pt-1.5")}>
        <TaskTitle item={item} done={!!c} compact={compact} />
        <div className={cn("flex flex-wrap items-center gap-y-1 text-muted-foreground", compact ? "gap-x-2 text-xs" : "gap-x-3 text-sm")}>
          {meta}
        </div>
        {item.notes && !c && <p className="text-sm text-muted-foreground whitespace-pre-line">{item.notes}</p>}
        {tick.error && <p className="text-sm text-red-600">{(tick.error as Error).message}</p>}
      </div>
      )}
      {compact || dense ? (
        <div className={cn("flex gap-1 shrink-0", dense ? "flex-row items-center" : "flex-col")}>
          <button type="button" onClick={() => run(c ? { undo: true } : { status: "skipped" })} disabled={tick.isPending}
            className={cn(dense ? "w-9 h-9" : "w-11 h-11", "rounded-xl text-muted-foreground hover:bg-secondary/60 flex items-center justify-center")}
            aria-label={c ? `Undo ${item.title}` : upcoming ? `Skip ${item.title} on ${dayHeading(entry.dueDate, today)}` : `Skip ${item.title} today`}
            title={c ? "Undo" : "Skip"}>
            {c ? <Undo2 className="w-5 h-5" /> : <SkipForward className="w-5 h-5" />}
          </button>
          {onEdit && (
            <button type="button" onClick={onEdit} className={cn(dense ? "w-9 h-9" : "w-11 h-11", "rounded-xl text-muted-foreground hover:bg-secondary/60 flex items-center justify-center")} aria-label={`Edit ${item.title}`} title="Edit">
              <Pencil className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
      <div className="flex flex-col sm:flex-row gap-1 shrink-0">
        {!c ? (
          <button type="button" onClick={() => run({ status: "skipped" })} disabled={tick.isPending}
            className="min-h-[44px] px-3 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-secondary/60 inline-flex items-center gap-1" aria-label={upcoming ? `Skip ${item.title} on ${dayHeading(entry.dueDate, today)}` : `Skip ${item.title} today`}>
            <SkipForward className="w-4 h-4" /> Skip
          </button>
        ) : (
          <button type="button" onClick={() => run({ undo: true })} disabled={tick.isPending}
            className="min-h-[44px] px-3 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-secondary/60 inline-flex items-center gap-1">
            <Undo2 className="w-4 h-4" /> Undo
          </button>
        )}
        {onEdit && (
          <button type="button" onClick={onEdit} className="w-11 h-11 rounded-xl hover:bg-secondary/60 flex items-center justify-center" aria-label={`Edit ${item.title}`}>
            <Pencil className="w-5 h-5" />
          </button>
        )}
      </div>
      )}
    </div>
  );
}

/** "Add a task": type (or say) it and press Enter — the shared smart add
 *  box (components/smart-add), so "p1", "every thursday", "next monday" and
 *  "@Jane Miles" work here exactly as on to-dos and checklists. You stay on
 *  the list; the new row glows if it landed here (Graeme, 2026-10-13/24). */
function AddTask({ listId, onAdded, compact = false }: { listId: number; today?: string; onAdded: (id: number) => void; compact?: boolean }) {
  return (
    <SmartAddBox
      context={{ kind: "team_list", listId }}
      size={compact ? "md" : "lg"}
      onAdded={a => { if (a.kind === "team_list_item" && a.destination.kind === "team_list" && a.destination.listId === listId) onAdded(a.id); }}
    />
  );
}

function AllTasks({ listId, items, onEdit }: { listId: number; items: TeamListItem[]; onEdit?: (id: number) => void }) {
  const [ordering, setOrdering] = useState(false);
  const reorder = useReorderItems(listId);
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  function move(index: number, delta: number) {
    const next = [...sorted];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    reorder.mutate(next.map(i => i.id), {
      onError: err => toast({ title: "Order didn't save", description: (err as Error).message, variant: "destructive" }),
    });
  }

  if (items.length === 0) return <p className="text-muted-foreground">No tasks yet.</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Every task on this list, whatever day it&apos;s due. This is the “List order” in Sort, and breaks any ties.</p>
        {onEdit && <button onClick={() => setOrdering(o => !o)} className={cn("min-h-[44px] px-4 rounded-xl border-2 font-semibold shrink-0", ordering ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
          {ordering ? "Done" : "Reorder"}
        </button>}
      </div>
      {reorder.isPending && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Saving order…</p>}
      {sorted.map((it, i) => (
        <div key={it.id} className="rounded-2xl border-2 border-border p-3 flex items-center gap-3">
          <span className={cn("w-3 h-3 rounded-full shrink-0", PRIORITY_STYLES[it.priority].dot)} />
          <button onClick={() => onEdit?.(it.id)} disabled={!onEdit} className="min-w-0 flex-1 text-left min-h-[44px] disabled:cursor-default">
            <span className="block font-semibold">{it.title}</span>
            <span className="block text-sm text-muted-foreground">
              <Repeat className="w-3.5 h-3.5 inline mr-1" />{describeRule(it.recurrence)}{it.timeOfDay ? ` · ${it.timeOfDay}` : ""}{it.carryOver ? " · carries over" : ""}
            </span>
          </button>
          {!onEdit ? null : ordering ? (
            <div className="flex gap-1">
              <button onClick={() => move(i, -1)} disabled={i === 0 || reorder.isPending} className="w-12 h-12 rounded-xl border-2 border-border flex items-center justify-center disabled:opacity-30" aria-label={`Move ${it.title} up`}><ArrowUp className="w-5 h-5" /></button>
              <button onClick={() => move(i, 1)} disabled={i === sorted.length - 1 || reorder.isPending} className="w-12 h-12 rounded-xl border-2 border-border flex items-center justify-center disabled:opacity-30" aria-label={`Move ${it.title} down`}><ArrowDown className="w-5 h-5" /></button>
            </div>
          ) : (
            <button onClick={() => onEdit(it.id)} className="w-12 h-12 rounded-xl hover:bg-secondary/60 flex items-center justify-center" aria-label={`Edit ${it.title}`}><Pencil className="w-5 h-5" /></button>
          )}
        </div>
      ))}
    </div>
  );
}
