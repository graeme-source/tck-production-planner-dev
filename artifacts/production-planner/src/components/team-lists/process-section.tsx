/**
 * "Start when needed" — Graeme's ad hoc recurring processes (25 Nov 2026).
 * Objectives E and F.
 *
 * "A checklist we manually run through every time we do something (e.g. a
 * new product launch or a test box launch)." On a team list these are the
 * tasks set to repeat "When needed": never due by themselves, shown here as
 * big cards with their sub-tasks, when they were last run, and a Start now
 * button. Start now puts a copy — the task and all its sub-tasks, as they
 * are right now — on the starter's own to-do list for today, where it's
 * ticked off; the master stays here for next time. Managers and admins can
 * also start one onto someone else's list.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Loader2, Pencil, Play, Plus, UserPlus, X } from "lucide-react";
import { lastRunLabel, openNowLabel } from "@workspace/subtasks";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useAuth } from "@/contexts/auth-context";
import { TodoSheet } from "@/components/todo-lists";
import { SubtaskList, SubtaskProgressChip } from "@/components/subtasks/subtask-ui";
import { resolveTodoLink } from "@/lib/todo-link";
import {
  TeamListApiError, useAddItem, useStartProcess, useTeamListPeople, type TeamListItem,
} from "./team-lists-api";

export function ProcessSection({ listId, processes, today, canEdit, compact = false, onEdit, onAdded }: {
  listId: number;
  processes: TeamListItem[];
  today: string;
  canEdit: boolean;
  compact?: boolean;
  onEdit?: (itemId: number) => void;
  /** A new process was added — the page opens it to add its sub-tasks. */
  onAdded?: (itemId: number) => void;
}) {
  // The to-do sheet opens straight onto a just-started copy ("Open it").
  const [sheetTaskId, setSheetTaskId] = useState<number | null>(null);
  // None yet: just the way to add one, on the full page only.
  if (processes.length === 0) return canEdit && !compact ? <AddProcess listId={listId} compact={false} hasAny={false} onAdded={onAdded} /> : null;
  return (
    <section className="space-y-3" aria-labelledby={`processes-${listId}`}>
      <div>
        <h3 id={`processes-${listId}`} className={cn("font-bold uppercase tracking-wide text-muted-foreground", compact ? "text-xs" : "text-sm")}>
          Start when needed
        </h3>
        {!compact && processes.length > 0 && (
          <p className="text-sm text-muted-foreground">Checklists to run through each time. Start one and it goes on your to-do list for today.</p>
        )}
      </div>
      <div className={cn("grid gap-3", !compact && "md:grid-cols-2 2xl:grid-cols-3")}>
        {processes.map(p => (
          <ProcessCard key={p.id} item={p} today={today} compact={compact} onEdit={onEdit ? () => onEdit(p.id) : undefined} onOpenTodo={setSheetTaskId} />
        ))}
      </div>
      {canEdit && <AddProcess listId={listId} compact={compact} hasAny={processes.length > 0} onAdded={onAdded} />}
      {sheetTaskId != null && <TodoSheet open initialTaskId={sheetTaskId} onClose={() => setSheetTaskId(null)} />}
    </section>
  );
}

function ProcessTitle({ item, compact }: { item: TeamListItem; compact: boolean }) {
  const cls = cn(compact ? "text-lg" : "text-xl", "font-bold leading-snug break-words");
  if (!item.url) return <h4 className={cls}>{item.title}</h4>;
  const { href, external } = resolveTodoLink(item.url);
  return (
    <h4 className={cls}>
      <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="underline decoration-2 underline-offset-4 text-primary inline-flex items-center gap-1">
        {item.title}{external && <ExternalLink className="w-4 h-4" />}
      </a>
    </h4>
  );
}

function ProcessCard({ item, today, compact, onEdit, onOpenTodo }: {
  item: TeamListItem; today: string; compact: boolean; onEdit?: () => void; onOpenTodo: (todoId: number) => void;
}) {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  const canStartForOthers = me?.role === "admin" || me?.role === "manager";
  const start = useStartProcess();
  const [open, setOpen] = useState(false);
  const [pickPerson, setPickPerson] = useState(false);
  // "You already have one open — start another?" waits here for an answer.
  const [confirm, setConfirm] = useState<{ assigneeId?: number; message: string } | null>(null);
  const subtasks = item.subtasks ?? [];
  const runs = item.runs ?? null;

  function run(assigneeId?: number, confirmDuplicate = false) {
    setConfirm(null);
    start.mutate({ itemId: item.id, assigneeId, confirmDuplicate }, {
      onSuccess: r => {
        const mine = r.assigneeId === me?.id;
        toast({
          title: mine ? "Started — it's on your to-do list" : `Started on ${r.assigneeName.split(" ")[0]}'s to-do list`,
          description: `${item.title}${r.subtaskCount ? ` · ${r.subtaskCount} sub-task${r.subtaskCount === 1 ? "" : "s"}` : ""} · for today`,
          action: mine ? <ToastAction altText="Open it" onClick={() => onOpenTodo(r.todoId)}>Open it</ToastAction> : undefined,
        });
      },
      onError: err => {
        if (err instanceof TeamListApiError && err.code === "ALREADY_OPEN") { setConfirm({ assigneeId, message: err.message }); return; }
        toast({ title: "Didn't start", description: (err as Error).message, variant: "destructive" });
      },
    });
  }

  const openNow = runs ? openNowLabel(runs) : "";
  return (
    <div className={cn("rounded-3xl border-2 border-border bg-card shadow-sm flex flex-col", compact ? "p-3 gap-2" : "p-4 gap-3")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <ProcessTitle item={item} compact={compact} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <SubtaskProgressChip subtasks={subtasks} ticks={false} open={open} onToggle={() => setOpen(o => !o)} size={compact ? "sm" : "md"} />
            {runs && <span>{lastRunLabel(runs, today)}</span>}
            {openNow && <span className="font-semibold text-primary">{openNow}</span>}
          </div>
        </div>
        {onEdit && (
          <button type="button" onClick={onEdit} aria-label={`Edit ${item.title}`} title="Edit"
            className="w-11 h-11 shrink-0 rounded-xl hover:bg-secondary/60 flex items-center justify-center text-muted-foreground">
            <Pencil className="w-5 h-5" />
          </button>
        )}
      </div>
      {item.notes && !compact && <p className="text-sm text-muted-foreground whitespace-pre-line">{item.notes}</p>}
      {open && <SubtaskList subtasks={subtasks} compact={compact} />}
      {subtasks.length === 0 && onEdit && !compact && (
        <button type="button" onClick={onEdit} className="self-start min-h-[40px] text-sm font-semibold text-primary hover:underline">
          + Add its sub-tasks
        </button>
      )}

      {confirm ? (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2" role="group" aria-label={confirm.message}>
          <p className="text-base font-bold">{confirm.message}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => run(confirm.assigneeId, true)} disabled={start.isPending}
              className="min-h-12 px-4 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-50">
              {start.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />} Start another
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="min-h-12 px-4 rounded-xl border-2 border-border bg-card font-semibold">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mt-auto">
          <button type="button" onClick={() => run()} disabled={start.isPending}
            className={cn("flex-1 rounded-2xl bg-primary text-primary-foreground font-bold inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50",
              compact ? "min-h-12 text-base" : "min-h-14 text-lg")}>
            {start.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />} Start now
          </button>
          {canStartForOthers && (
            <button type="button" onClick={() => setPickPerson(true)} disabled={start.isPending} title="Start it on someone else's to-do list"
              aria-label={`Start ${item.title} for someone else`}
              className={cn("rounded-2xl border-2 border-border bg-card font-semibold inline-flex items-center justify-center gap-2 px-3 hover:bg-secondary/60",
                compact ? "min-h-12" : "min-h-14")}>
              <UserPlus className="w-5 h-5" /><span className={compact ? "sr-only" : "hidden sm:inline"}>For someone else</span>
            </button>
          )}
        </div>
      )}
      {pickPerson && (
        <PersonPicker title={item.title} meId={me?.id ?? null} onClose={() => setPickPerson(false)}
          onPick={id => { setPickPerson(false); run(id === me?.id ? undefined : id); }} />
      )}
    </div>
  );
}

/** Whose to-do list to start it on (managers and admins). */
function PersonPicker({ title, meId, onPick, onClose }: { title: string; meId: number | null; onPick: (id: number) => void; onClose: () => void }) {
  const people = useTeamListPeople(true);
  const [q, setQ] = useState("");
  const shown = (people.data ?? []).filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={onClose}
      onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Start it for someone" onClick={e => e.stopPropagation()}
        className="bg-background border-2 border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-xl font-bold">Start it for…</h2>
            <p className="text-base text-muted-foreground break-words">{title} — goes on their to-do list for today</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center shrink-0">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="px-5 pt-4">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search names…" autoFocus aria-label="Search names"
            className="w-full h-12 rounded-xl border-2 border-border bg-background px-3 text-base focus:outline-none focus:border-primary" />
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-2">
          {people.isLoading && <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</p>}
          {people.error && <p className="text-red-600">{(people.error as Error).message}</p>}
          {shown.map(p => (
            <button key={p.id} type="button" onClick={() => onPick(p.id)}
              className="w-full min-h-14 px-4 rounded-2xl border-2 border-border bg-card text-left text-lg font-semibold hover:bg-secondary/60">
              {p.name}{p.id === meId ? " (me)" : ""}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Add a new "When needed" checklist; the page opens it so its sub-tasks
 *  can be added straight away. */
function AddProcess({ listId, compact, hasAny, onAdded }: { listId: number; compact: boolean; hasAny: boolean; onAdded?: (id: number) => void }) {
  const add = useAddItem(listId);
  const [openBox, setOpenBox] = useState(false);
  const [title, setTitle] = useState("");
  if (!openBox) {
    return (
      <button type="button" onClick={() => setOpenBox(true)}
        className={cn("w-full rounded-2xl border-2 border-dashed border-border text-left font-semibold text-muted-foreground hover:bg-secondary/40 inline-flex items-center gap-2 px-4",
          compact ? "min-h-12 text-sm" : "min-h-14 text-base")}>
        <Plus className="w-5 h-5" /> {hasAny ? "Add another checklist to start when needed" : "Add a checklist to start when needed (e.g. an Ads or Email checklist)"}
      </button>
    );
  }
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    add.mutate({ title: t, recurrence: { kind: "on_demand" }, carryOver: false }, {
      onSuccess: row => { setTitle(""); setOpenBox(false); onAdded?.(row.id); },
      onError: err => toast({ title: "Didn't add it", description: (err as Error).message, variant: "destructive" }),
    });
  };
  return (
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); submit(); }}>
      <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="Checklist name, e.g. Ads checklist" maxLength={300}
        aria-label="New checklist name"
        className="flex-1 min-w-0 h-14 rounded-2xl border-2 border-border bg-background px-4 text-lg focus:outline-none focus:border-primary" />
      <button type="submit" disabled={!title.trim() || add.isPending}
        className="h-14 px-5 rounded-2xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-40">
        {add.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />} Add
      </button>
      <button type="button" onClick={() => { setOpenBox(false); setTitle(""); }} aria-label="Cancel"
        className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center"><X className="w-6 h-6" /></button>
    </form>
  );
}
