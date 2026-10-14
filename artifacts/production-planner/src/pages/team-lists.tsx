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
  ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, ChevronRight, Clock, ExternalLink, FileUp,
  Loader2, Pencil, Plus, Settings2, SkipForward, Undo2, ListChecks, Repeat,
} from "lucide-react";
import { describeRule } from "@workspace/recurrence";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  COMING_UP_OPEN_KEY, comingUpOpen, completionLabel, dayHeading, overdueLabel, TEAM_LIST_DEFAULT_SORT, teamTaskSortFields,
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
function ListDetail({ id }: { id: number }) {
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
  const overdue = sortEntries(entries.filter(e => e.overdue));
  const todays = sortEntries(entries.filter(e => !e.overdue));
  const todayLabel = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <div className="space-y-6 w-full">
      <PageHeader title={`${list.emoji ? `${list.emoji} ` : ""}${list.name}`} description={list.description ?? "Team list"} />

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/lists" className="min-h-[48px] px-3 rounded-xl inline-flex items-center gap-2 font-semibold hover:bg-secondary/60"><ArrowLeft className="w-5 h-5" /> All lists</Link>
        <span className="flex-1" />
        {list.canEdit && <>
        <button onClick={() => setImportOpen(true)} className="min-h-[48px] px-4 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary/60">
          <FileUp className="w-5 h-5" /> <span className="hidden sm:inline">Import from Todoist</span><span className="sm:hidden">Import</span>
        </button>
        <button onClick={() => setSettingsOpen(true)} className="min-h-[48px] px-4 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary/60">
          <Settings2 className="w-5 h-5" /> Settings
        </button>
        </>}
      </div>

      {list.archived && (
        <p className="rounded-2xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 font-semibold">This list is archived — restore it in Settings to use it again.</p>
      )}

      <div className="rounded-3xl border-2 border-border bg-card p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-display text-2xl font-bold">Today · {todayLabel}</h2>
          <span className={cn("text-lg font-semibold", progress.overdue > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{progressText(progress)}</span>
        </div>
        {progress.total > 0 && <ProgressBar progress={progress} color={list.color} />}
      </div>

      <TaskSortControl spec={sort} onChange={setSort} />

      {overdue.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">Overdue</h3>
          {overdue.map(e => byId.get(e.itemId) && <TaskRow key={`${e.itemId}-${e.dueDate}`} item={byId.get(e.itemId)!} entry={e} today={today} onEdit={list.canEdit ? () => setEditingId(e.itemId) : undefined} justAdded={e.itemId === justAddedId} isNew={addedIds.has(e.itemId)} />)}
        </section>
      )}

      <section className="space-y-3">
        {overdue.length > 0 && <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Today</h3>}
        {todays.length === 0 && overdue.length === 0 && (
          <p className="rounded-2xl border-2 border-dashed border-border p-6 text-center text-muted-foreground text-lg">
            {data.items.length === 0 ? (list.canEdit ? "No tasks yet — add the first one below." : "No tasks yet.") : "Nothing due today."}
          </p>
        )}
        {todays.map(e => byId.get(e.itemId) && <TaskRow key={`${e.itemId}-${e.dueDate}`} item={byId.get(e.itemId)!} entry={e} today={today} onEdit={list.canEdit ? () => setEditingId(e.itemId) : undefined} justAdded={e.itemId === justAddedId} isNew={addedIds.has(e.itemId)} />)}
        {list.canEdit && <AddTask listId={list.id} onAdded={onAdded} />}
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
                {sortTasks(day.entries.filter(e => byId.has(e.itemId)), sort, e => teamTaskSortFields(byId.get(e.itemId)!)).map(e => (
                  <TaskRow key={`${e.itemId}-${e.dueDate}`} item={byId.get(e.itemId)!} entry={e} today={today} upcoming
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

      {editing && list.canEdit && <ItemEditModal key={editing.id} item={editing} today={today} onClose={() => setEditingId(null)} />}
      {settingsOpen && list.canEdit && <ListSettingsModal list={list} onClose={() => setSettingsOpen(false)} />}
      {importOpen && list.canEdit && <ImportModal listId={list.id} onClose={() => setImportOpen(false)} onEditItem={itemId => { setImportOpen(false); setEditingId(itemId); }} />}
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
function TaskTitle({ item, done }: { item: TeamListItem; done: boolean }) {
  const cls = cn("text-lg font-semibold leading-snug break-words", done && "line-through text-muted-foreground");
  if (!item.url) return <span className={cls}>{item.title}</span>;
  if (item.url.startsWith("/")) return <Link href={item.url} className={cn(cls, "underline decoration-2 underline-offset-4 text-primary")}>{item.title}</Link>;
  return (
    <a href={item.url} target="_blank" rel="noreferrer" className={cn(cls, "underline decoration-2 underline-offset-4 text-primary inline-flex items-center gap-1")}>
      {item.title} <ExternalLink className="w-4 h-4" />
    </a>
  );
}

function TaskRow({ item, entry, today, onEdit, justAdded = false, isNew = false, upcoming = false }: {
  item: TeamListItem; entry: DayEntry; today: string;
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

  return (
    <div ref={ref} data-just-added={justAdded ? "true" : undefined}
      className={cn("rounded-2xl border-2 bg-card p-3 sm:p-4 flex items-start gap-3 transition-all duration-500 scroll-mb-28",
        justAdded ? "border-primary ring-4 ring-primary/30 bg-primary/5" : entry.overdue && !c ? "border-amber-300 dark:border-amber-700" : "border-border",
        c && "bg-muted/40")}>
      <button
        type="button"
        onClick={() => run(c ? { undo: true } : { status: "done" })}
        disabled={tick.isPending}
        aria-label={c ? `Undo ${item.title}` : upcoming ? `Mark ${item.title} done early` : `Mark ${item.title} done`}
        className={cn("w-14 h-14 rounded-full border-4 flex items-center justify-center shrink-0 transition-colors",
          c?.status === "done" ? "bg-emerald-500 border-emerald-500 text-white" : c?.status === "skipped" ? "bg-muted border-muted-foreground/40 text-muted-foreground" : PRIORITY_STYLES[item.priority].ring)}
      >
        {tick.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : c?.status === "done" ? <Check className="w-8 h-8" /> : c?.status === "skipped" ? <SkipForward className="w-6 h-6" /> : null}
      </button>
      <div className="min-w-0 flex-1 pt-1 space-y-1">
        <TaskTitle item={item} done={!!c} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {justAdded && <span className="font-bold text-primary">Just added</span>}
          {isNew && !c && onEdit && (
            <button type="button" onClick={onEdit}
              className="min-h-[36px] px-3 rounded-full border-2 border-primary/40 text-primary font-semibold inline-flex items-center gap-1 hover:bg-primary/10">
              <Repeat className="w-4 h-4" /> {describeRule(item.recurrence)} · Set days
            </button>
          )}
          {item.priority < 4 && <span className="font-bold"><span className={cn("inline-block w-2.5 h-2.5 rounded-full mr-1", PRIORITY_STYLES[item.priority].dot)} />{PRIORITY_STYLES[item.priority].label}</span>}
          {item.timeOfDay && <span className="inline-flex items-center gap-1"><Clock className="w-4 h-4" />{item.timeOfDay}</span>}
          {entry.overdue && !c && <span className="font-semibold text-amber-700 dark:text-amber-400">{overdueLabel(entry.dueDate, today)}</span>}
          {c && <span className={c.status === "done" ? "text-emerald-700 dark:text-emerald-400" : ""}>{completionLabel(c, entry.dueDate, today)}</span>}
        </div>
        {item.notes && !c && <p className="text-sm text-muted-foreground whitespace-pre-line">{item.notes}</p>}
        {tick.error && <p className="text-sm text-red-600">{(tick.error as Error).message}</p>}
      </div>
      <div className="flex flex-col sm:flex-row gap-1 shrink-0">
        {!c ? (
          <button type="button" onClick={() => run({ status: "skipped" })} disabled={tick.isPending}
            className="min-h-[48px] px-3 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-secondary/60 inline-flex items-center gap-1" aria-label={upcoming ? `Skip ${item.title} on ${dayHeading(entry.dueDate, today)}` : `Skip ${item.title} today`}>
            <SkipForward className="w-4 h-4" /> Skip
          </button>
        ) : (
          <button type="button" onClick={() => run({ undo: true })} disabled={tick.isPending}
            className="min-h-[48px] px-3 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-secondary/60 inline-flex items-center gap-1">
            <Undo2 className="w-4 h-4" /> Undo
          </button>
        )}
        {onEdit && (
          <button type="button" onClick={onEdit} className="w-12 h-12 rounded-xl hover:bg-secondary/60 flex items-center justify-center" aria-label={`Edit ${item.title}`}>
            <Pencil className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** "Add a task": type and press Enter; it's added as every day and you
 *  stay on the list — the box clears and keeps the cursor for the next one
 *  (Graeme, 2026-10-13). The new row's "Set days" chip opens its editor. */
function AddTask({ listId, onAdded }: { listId: number; onAdded: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const add = useAddItem(listId);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || add.isPending) return;
    add.mutate({ title: t }, {
      onSuccess: row => {
        // Only clear what was sent — anything typed meanwhile stays.
        setTitle(cur => (cur.trim() === t ? "" : cur));
        onAdded(row.id);
        inputRef.current?.focus({ preventScroll: true });
      },
    });
  }
  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex gap-2">
        <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)} placeholder="Add a task" enterKeyHint="done"
          className="flex-1 h-14 rounded-2xl border-2 border-dashed border-border bg-background px-4 text-lg focus:outline-none focus:border-primary focus:border-solid" aria-label="Add a task" maxLength={300} />
        <button type="submit" disabled={!title.trim() || add.isPending}
          className="h-14 px-5 rounded-2xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-40">
          {add.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />} Add
        </button>
      </div>
      {add.error && <p className="text-sm text-red-600">Couldn't add it — {(add.error as Error).message}. Your text is still here; try again.</p>}
    </form>
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
