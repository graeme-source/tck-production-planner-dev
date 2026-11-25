/**
 * One to-do: its notes, link, sub-tasks, photos and comments, and editing it.
 *
 *   useTodoTask    everything it can do (tick, save, comment, photos, delete…)
 *   TodoTaskBody   what it looks like, big or `compact` (the docked panel)
 *   TodoTaskDialog the pop-up over the full-screen list, opened already
 *                  editable, with an explicit Save
 *   TodoEditPage   the docked panel's edit page, which saves as you type
 * The docked panel's own page for a to-do is in todo-panel.tsx.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Camera, Check, ClipboardList, Lightbulb, ListChecks, Loader2, Pencil, RotateCcw, Send, Trash2,
} from "lucide-react";
import { sourceLabel, type ParentTickChoice } from "@workspace/subtasks";
import { SaveChip } from "@/components/save-chip";
import { EditorDialog } from "@/components/recipe-editor/editor-dialog";
import {
  ParentTickInline, SubtaskEditor, SubtaskList, SubtaskProgressChip, useParentTickGuard,
} from "@/components/subtasks/subtask-ui";
import { PinnedFooter } from "@/components/ui/pinned-save-bar";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { useAutosave } from "@/hooks/use-autosave";
import { useTodoEditDraft, useTodoTextDraft } from "@/hooks/use-todo-draft";
import { todoAutosavePatch, todoFormFrom, todoFormPatch, todoFormValid, type TodoForm, type TodoPatch } from "@/lib/todo-edit";
import { applyEditDraft } from "@/lib/todo-drafts";
import { taskLink } from "@/lib/todo-link";
import { cn } from "@/lib/utils";
import {
  BASE, fetchTask, isOverdue, jsonOrThrow, parseTs, patchTodo, post, PRIORITY_META, refreshProcessRuns, subtaskViews, todoSubtaskApi, useTickTodoSubtask,
  type TodoTask,
} from "./api";
import { DateChip, LinkButton, PriorityChip } from "./bits";
import { TodoAnchor } from "./todo-anchor";
import { TodoFields } from "./todo-fields";

export function useTodoTask({ taskId, meId, canManage, onClose }: {
  taskId: number;
  meId: number;
  canManage: boolean;
  /** Finished with this to-do (ticked off, deleted): back to the list. */
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["todo", taskId],
    queryFn: () => fetchTask(taskId),
    staleTime: 5_000,
  });
  const task = query.data;

  const [comment, setComment] = useTodoTextDraft({ kind: "comment", taskId });
  const commentsEndRef = useRef<HTMLDivElement>(null);
  // Separate camera input for the "done + improvement" path: it opens the
  // camera straight away and, once the shot lands, finishes the job.
  const improvementCameraRef = useRef<HTMLInputElement>(null);
  const [pendingImprovement, setPendingImprovement] = useState(false);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["todo", taskId] });
    qc.invalidateQueries({ queryKey: ["todos"] });
    refreshProcessRuns(qc);
  }

  const saveMut = useMutation({
    mutationFn: (p: TodoPatch) => patchTodo(taskId, p),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast({ title: "Couldn't save the task", description: `${e.message} — your changes are still here.`, variant: "destructive" }),
  });
  const completeMut = useMutation({
    mutationFn: (v: boolean | { done: boolean; subtasks?: ParentTickChoice }) => {
      const { done, subtasks } = typeof v === "boolean" ? { done: v, subtasks: undefined } : v;
      return post(`/api/todos/${taskId}/${done ? "complete" : "reopen"}`, done && subtasks ? { subtasks } : undefined);
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Couldn't update the task", description: e.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: () => fetch(`${BASE}/api/todos/${taskId}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow),
    onSuccess: () => { invalidate(); onClose(); toast({ title: "Task deleted" }); },
    onError: (e: Error) => toast({ title: "Couldn't delete the task", description: e.message, variant: "destructive" }),
  });
  const commentMut = useMutation({
    mutationFn: (body: string) => post(`/api/todos/${taskId}/comments`, { body }),
    onSuccess: () => {
      setComment("");
      invalidate();
      setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 150);
    },
    onError: (e: Error) => toast({ title: "Comment didn't send", description: e.message, variant: "destructive" }),
  });
  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${BASE}/api/todos/${taskId}/attachments`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      return jsonOrThrow(res);
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });
  const deleteAttMut = useMutation({
    mutationFn: (attId: number) => fetch(`${BASE}/api/todos/attachments/${attId}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow),
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Couldn't delete it", description: e.message, variant: "destructive" }),
  });
  const tagImprovementMut = useMutation({
    mutationFn: () => post(`/api/todos/${taskId}/tag-improvement`) as Promise<{ awaitingApproval?: boolean }>,
    onSuccess: (res) => {
      invalidate();
      toast({
        title: "Logged as an improvement",
        description: res?.awaitingApproval
          ? "Photos and all — a manager will sign it off."
          : "Add a photo to it and it'll be ready for sign-off.",
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't log it", description: e.message, variant: "destructive" }),
  });

  // Sub-tasks: ticked here; "Tick the N left as well?" asked in the footer.
  const guard = useParentTickGuard();
  const subtaskTick = useTickTodoSubtask();

  /** Mark as done: keep any edits first (`saveFirst`), tick it, back to the list. */
  async function markDone(opts: { saveFirst?: () => Promise<unknown>; title?: string } = {}) {
    if (!task) return;
    const choice = await guard.choose(subtaskViews(task), task.title);
    if (choice === null) return;
    try {
      await opts.saveFirst?.();
      await completeMut.mutateAsync({ done: true, subtasks: choice });
    } catch { return; }
    onClose();
    toast({
      title: "Done ✓",
      description: opts.title?.trim() || task.title,
      action: (
        <ToastAction altText="Undo" onClick={() => { void post(`/api/todos/${taskId}/reopen`).then(invalidate); }}>
          Undo
        </ToastAction>
      ),
    });
  }

  /**
   * "Mark it done, and it's an improvement" — the moment someone finishes a
   * job is the one moment they're standing in front of the evidence, so this
   * is where we ask for the photo rather than hoping they go and file one
   * later. With media already on the task it just completes and files it;
   * without, it opens the camera first and files it once the shot is in.
   */
  const improvementSubtaskChoice = useRef<ParentTickChoice | undefined>(undefined);
  const completeAsImprovement = async () => {
    const choice = await guard.choose(task ? subtaskViews(task) : [], task?.title ?? "");
    if (choice === null) return;
    improvementSubtaskChoice.current = choice;
    if ((task?.attachments?.length ?? 0) === 0) {
      setPendingImprovement(true);
      improvementCameraRef.current?.click();
      return;
    }
    await completeMut.mutateAsync({ done: true, subtasks: choice });
    await tagImprovementMut.mutateAsync();
  };

  const canEdit = !!task && (canManage || task.assignee_id === meId);
  const canDelete = !!task && (canManage || task.created_by === meId);
  const isDone = task?.status === "done";
  const busy = saveMut.isPending || completeMut.isPending || pendingImprovement;

  return {
    taskId, meId, canManage, task, isLoading: query.isLoading, error: query.error, invalidate,
    saveMut, completeMut, deleteMut, commentMut, uploadMut, deleteAttMut, tagImprovementMut,
    comment, setComment, commentsEndRef, improvementCameraRef, improvementSubtaskChoice, pendingImprovement, setPendingImprovement,
    guard, subtaskTick, markDone, completeAsImprovement, canEdit, canDelete, isDone, busy,
  };
}

export type TodoTaskState = ReturnType<typeof useTodoTask>;

/** A to-do's page: everything but its title bar and its footer buttons. */
export function TodoTaskBody({ t, fields, compact = false, onEdit }: {
  t: TodoTaskState;
  /** Drawn instead of the read-only card — the pop-up opens editable. */
  fields?: ReactNode;
  compact?: boolean;
  /** The card's Edit button (the docked panel's edit page). */
  onEdit?: () => void;
}) {
  const {
    task, isLoading, error, invalidate, meId, canManage, completeMut, deleteMut, commentMut, uploadMut, deleteAttMut, tagImprovementMut,
    comment, setComment, commentsEndRef, improvementCameraRef, improvementSubtaskChoice, pendingImprovement, setPendingImprovement,
    subtaskTick, completeAsImprovement, canEdit, canDelete, isDone, busy,
  } = t;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const addingSub = useTodoTextDraft({ kind: "subtask", taskId: t.taskId });
  // One half-typed earlier: back where it was.
  const [editingSubs, setEditingSubs] = useState(addingSub[0].trim() !== "");
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-3 text-lg"><Loader2 className="w-6 h-6 animate-spin" /> Loading…</div>
      )}
      {!isLoading && (error != null || !task) && (
        <div className={cn("my-5 rounded-2xl bg-destructive/10 text-destructive font-semibold", compact ? "p-4 text-base" : "p-5 text-lg")}>This task is gone — it may have been deleted.</div>
      )}

      {task && (
        <div className={compact ? "space-y-4" : "space-y-5 pt-4"} data-testid="todo-popup">
          <p className={cn("text-muted-foreground font-medium", compact ? "text-sm" : "text-base")}>
            For <strong className="text-foreground">{task.assignee_name}</strong>
            {task.created_by_name ? <> · added by <strong className="text-foreground">{task.created_by_name}</strong></> : null}
            {task.acknowledged_at ? <> · <span className="text-primary font-semibold">seen ✓</span></> : null}
            {isDone ? <> · <span className="text-primary font-semibold">done ✓</span></> : null}
          </p>
          {/* Started from a team list: the name links back to the master. */}
          {task.source_team_list_item_id && (
            task.source_list_id ? (
              <TodoAnchor url={`/lists/${task.source_list_id}`}
                className={cn("inline-flex items-center gap-2 min-h-[44px] font-semibold text-primary underline decoration-2 underline-offset-4", compact ? "text-sm" : "text-base")}>
                <ListChecks className="w-5 h-5 shrink-0" /> <span className="min-w-0 break-words">{sourceLabel(task.source_list_name, task.source_item_title)}</span>
              </TodoAnchor>
            ) : (
              <p className="text-base text-muted-foreground font-medium">{sourceLabel(null, null)}</p>
            )
          )}

          {fields ?? (
            <div className="rounded-2xl border-2 border-border bg-card overflow-hidden flex shadow-sm">
              <div className={cn("flex-shrink-0", compact ? "w-1.5" : "w-3", PRIORITY_META[task.priority].bar)} />
              <div className={cn("flex-1 min-w-0 space-y-3", compact ? "p-3" : "p-5")}>
                <h3 className={cn("font-display font-bold leading-tight break-words", compact ? "text-xl" : "text-2xl md:text-3xl", isDone && "line-through text-muted-foreground")}>{task.title}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityChip p={task.priority} big={!compact} />
                  {task.scheduled_for && <DateChip label="Do" iso={task.scheduled_for} big={!compact} />}
                  {task.due_date && <DateChip label="Due" iso={task.due_date} overdue={isOverdue(task)} big={!compact} />}
                </div>
                {task.notes && <p className={cn("leading-relaxed whitespace-pre-wrap break-words", compact ? "text-base" : "text-xl")}>{task.notes}</p>}
                {onEdit && canEdit && (
                  <button type="button" onClick={onEdit}
                    className="w-full min-h-12 px-4 rounded-xl border-2 border-border bg-card text-base font-bold inline-flex items-center justify-center gap-2 hover:bg-secondary/60">
                    <Pencil className="w-4 h-4" /> Edit
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Sub-tasks (Graeme, 25 Nov 2026): tick each one off here; change
              them (this to-do's own copy) with "Change the sub-tasks". */}
          {(subtaskViews(task).length > 0 || canEdit) && (
            <section className="space-y-2" aria-label="Sub-tasks">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-lg font-bold">Sub-tasks</h3>
                <SubtaskProgressChip subtasks={subtaskViews(task)} ticks />
                <span className="flex-1" />
                {canEdit && (
                  <button type="button" onClick={() => setEditingSubs(e => !e)} aria-pressed={editingSubs}
                    className={cn("min-h-[44px] px-4 rounded-xl border-2 font-semibold inline-flex items-center gap-2",
                      editingSubs ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-secondary/60")}>
                    {editingSubs ? <><Check className="w-4 h-4" /> Done changing</> : <><Pencil className="w-4 h-4" /> {subtaskViews(task).length ? "Change the sub-tasks" : "Add sub-tasks"}</>}
                  </button>
                )}
              </div>
              {editingSubs && canEdit ? (
                <SubtaskEditor subtasks={subtaskViews(task)} api={todoSubtaskApi(task.id)} onChanged={invalidate} compact={compact} adding={addingSub}
                  hint="Saved as you type. Ticks are kept." />
              ) : (
                <SubtaskList subtasks={subtaskViews(task)} compact={compact} busyId={subtaskTick.isPending ? subtaskTick.variables?.id ?? null : null}
                  onTick={canEdit && !isDone ? (s, done) => subtaskTick.mutate({ id: s.id, done }) : undefined} />
              )}
            </section>
          )}

          {taskLink(task) && <LinkButton url={taskLink(task)!} big={!compact} />}

          {/* Photos & videos — evidence of the job or the problem. */}
          <div className="space-y-3">
            {task.attachments.length > 0 && (
              <div className={cn("grid grid-cols-2 gap-3", !compact && "sm:grid-cols-3")}>
                {task.attachments.map(att => (
                  <div key={att.id} className="relative rounded-2xl overflow-hidden border-2 border-border bg-black/5 group">
                    {att.kind === "image" ? (
                      <a href={`${BASE}/api/todos/attachments/${att.id}`} target="_blank" rel="noopener noreferrer">
                        <img
                          src={`${BASE}/api/todos/attachments/${att.id}`}
                          alt={att.file_name ?? "Task photo"}
                          className="w-full h-40 object-cover"
                          loading="lazy"
                        />
                      </a>
                    ) : (
                      <video
                        src={`${BASE}/api/todos/attachments/${att.id}`}
                        controls
                        preload="metadata"
                        className="w-full h-40 object-cover bg-black"
                      />
                    )}
                    {(canManage || att.uploaded_by === meId) && (
                      <button
                        type="button"
                        onClick={() => deleteAttMut.mutate(att.id)}
                        disabled={deleteAttMut.isPending}
                        className="absolute top-2 right-2 w-11 h-11 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-destructive transition-colors"
                        aria-label="Delete this photo or video"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    {att.uploaded_by_name && (
                      <span className="absolute bottom-0 inset-x-0 px-2 py-1 text-[11px] font-semibold text-white bg-gradient-to-t from-black/70 to-transparent break-words">
                        {att.uploaded_by_name}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) uploadMut.mutate(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMut.isPending}
              className="w-full min-h-14 rounded-2xl border-2 border-dashed border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors disabled:opacity-50"
            >
              {uploadMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
              {uploadMut.isPending ? "Uploading…" : "Add a photo or video"}
            </button>
          </div>

          {/* Camera for the "done + improvement" path. Completing the job is
              chained onto the upload so the photo and the sign-off are one
              action from the person's point of view. */}
          <input
            ref={improvementCameraRef}
            type="file"
            accept="image/*,video/*"
            capture="environment"
            className="hidden"
            onChange={async e => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) { setPendingImprovement(false); return; }
              try {
                await uploadMut.mutateAsync(file);
                await completeMut.mutateAsync({ done: true, subtasks: improvementSubtaskChoice.current });
                await tagImprovementMut.mutateAsync();
              } finally {
                setPendingImprovement(false);
              }
            }}
          />

          {task.improvement_id && (
            <div className="flex items-center gap-2 text-base font-bold text-primary bg-primary/10 rounded-2xl px-5 py-3.5">
              <Lightbulb className="w-5 h-5 flex-shrink-0" />
              In the improvement library ✓
            </div>
          )}

          {/* Improvement + delete. Finishing a job is the moment someone is
              standing in front of what they changed, so the improvement
              option lives here rather than as a step they'd have to remember. */}
          <div className={cn("grid grid-cols-1 gap-3", !compact && "sm:grid-cols-2")}>
            {!isDone && !task.improvement_id && canEdit && (
              <button
                type="button"
                onClick={() => void completeAsImprovement()}
                disabled={busy || tagImprovementMut.isPending}
                className="min-h-16 px-2 py-2 rounded-2xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-lg font-bold flex flex-col items-center justify-center gap-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50 active:scale-[0.99]"
              >
                <span className="flex items-center gap-2">
                  {pendingImprovement || tagImprovementMut.isPending
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <Lightbulb className="w-5 h-5" />}
                  Done — and it's an improvement
                </span>
                <span className="text-sm font-semibold opacity-80">
                  {(task.attachments?.length ?? 0) === 0 ? "Takes a photo first" : "Sends it for sign-off"}
                </span>
              </button>
            )}
            {isDone && !task.improvement_id && canEdit && (
              <button
                type="button"
                onClick={() => tagImprovementMut.mutate()}
                disabled={tagImprovementMut.isPending}
                className="h-14 rounded-2xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-lg font-bold flex items-center justify-center gap-2 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50"
              >
                {tagImprovementMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lightbulb className="w-5 h-5" />}
                This was an improvement
              </button>
            )}
            {canDelete && (
              confirmDelete ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => deleteMut.mutate()}
                    disabled={deleteMut.isPending}
                    className="flex-1 min-h-14 rounded-2xl bg-destructive text-destructive-foreground text-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50"
                  >
                    {deleteMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                    Really delete?
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-14 px-4 rounded-2xl border-2 border-border bg-card text-base font-bold hover:bg-secondary/50">
                    Keep it
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="h-14 rounded-2xl border-2 border-destructive/40 text-destructive text-lg font-bold flex items-center justify-center gap-2 hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-5 h-5" /> Delete
                </button>
              )
            )}
          </div>

          {/* Timeline */}
          <div className="pt-2">
            <h3 className="text-lg font-bold text-muted-foreground mb-3">What's happened</h3>
            <div className="space-y-3">
              {task.comments.map(c =>
                c.kind === "event" ? (
                  <p key={c.id} className={cn("text-center text-muted-foreground font-medium", compact ? "text-sm" : "text-base")}>
                    {c.body} · {format(parseTs(c.created_at), "EEE d MMM, HH:mm")}
                  </p>
                ) : (
                  <div key={c.id} className={cn(
                    "rounded-2xl max-w-[85%]", compact ? "p-3" : "p-4",
                    c.user_id === meId ? "bg-primary/10 ml-auto" : "bg-secondary/60",
                  )}>
                    <p className="text-sm font-bold text-muted-foreground mb-1">
                      {c.user_name ?? "Someone"} · {format(parseTs(c.created_at), "EEE d MMM, HH:mm")}
                    </p>
                    <p className={cn("leading-relaxed whitespace-pre-wrap break-words", compact ? "text-base" : "text-lg")}>{c.body}</p>
                  </div>
                ),
              )}
              <div ref={commentsEndRef} />
            </div>

            <form
              className="flex gap-2 mt-4"
              onSubmit={e => { e.preventDefault(); if (comment.trim()) commentMut.mutate(comment.trim()); }}
            >
              <input
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder={compact ? "Question or update…" : "Ask a question or leave an update…"}
                aria-label="Ask a question or leave an update"
                className={cn("flex-1 min-w-0 h-14 rounded-2xl border-2 border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40", compact ? "px-3 text-base" : "px-4 text-lg")}
              />
              <button
                type="submit"
                disabled={!comment.trim() || commentMut.isPending}
                className="w-14 h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-all flex-shrink-0"
                aria-label="Send comment"
              >
                {commentMut.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/** The footer's left button: Mark as done / Put it back on the list. */
export function TodoDoneButton({ t, onMarkDone, primary = false }: { t: TodoTaskState; onMarkDone: () => void; primary?: boolean }) {
  const { completeMut, isDone, busy } = t;
  const cls = cn("min-h-14 px-4 rounded-2xl text-base sm:text-lg font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50",
    primary && !isDone ? "flex-1 bg-[#7cb342] text-white hover:bg-[#6a9c37]" : "border-2 border-border bg-card hover:bg-secondary/50", primary && "flex-1");
  return isDone ? (
    <button type="button" onClick={() => completeMut.mutate(false)} disabled={busy} className={cls}>
      {completeMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <RotateCcw className="w-5 h-5" />}
      Put it back on the list
    </button>
  ) : (
    <button type="button" onClick={onMarkDone} disabled={busy} className={cls}>
      {completeMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
      Mark as done
    </button>
  );
}

// ── The task pop-up: view + edit in one ─────────────────────────────────────
// Opens over the list ALREADY editable (Graeme, 2026-10-13: "I actually just
// want to be able to edit it from the main to-do list, and then save, and
// then it goes back to the to-do list"). Saving is explicit — the pinned
// green "Save changes" — not autosave, matching how to-dos always saved:
// every save writes "… edited the task" on the timeline, and autosave would
// write one per pause in typing. Closing with unsaved changes asks
// Save / Discard / Keep editing (the shared EditorDialog guard).
//
// "Mark as done" is deliberately NOT the primary: it was the big green
// button on the old detail page, and people pressed it thinking it saved.
// It's an outlined button on the left of the footer; the list row's tick
// circle is still the quick way.

export function TodoTaskDialog({ taskId, meId, canManage, onClose }: {
  taskId: number;
  meId: number;
  canManage: boolean;
  onClose: () => void;
}) {
  const t = useTodoTask({ taskId, meId, canManage, onClose });
  const { task, canEdit, saveMut, guard } = t;

  // The form starts from the task as first loaded. Comparing against that
  // (not the latest refetch) means a save only sends what THIS person
  // changed, never undoing someone else's edit made meanwhile.
  const [baseline, setBaseline] = useState<TodoForm | null>(null);
  const [form, setForm] = useState<TodoForm | null>(null);
  useEffect(() => {
    if (task && baseline === null) {
      const f = todoFormFrom(task);
      setBaseline(f);
      setForm(f);
    }
  }, [task, baseline]);

  const patch = baseline && form ? todoFormPatch(baseline, form) : null;
  const dirty = patch !== null;
  const valid = form ? todoFormValid(form) : false;

  /** Save what changed (if anything), then back to the list. */
  async function saveAndClose() {
    if (patch) {
      if (!valid) { toast({ title: "It needs a title", description: "Type what needs doing, then save.", variant: "destructive" }); return; }
      try { await saveMut.mutateAsync(patch); } catch { return; }
      toast({ title: "Task updated" });
    }
    onClose();
  }

  return (
    <EditorDialog
      open
      onClose={onClose}
      title={<><ClipboardList className="w-6 h-6 text-primary" /> {canEdit ? "Edit to-do" : "To-do"}</>}
      dirty={dirty}
      onSaveRequest={() => void saveAndClose()}
      entityLabel="to-do"
      widthClassName="sm:max-w-3xl"
      noAutoFocus
    >
      <TodoTaskBody t={t} fields={canEdit ? (form ? <TodoFields form={form} onChange={setForm} onEnter={() => void saveAndClose()} /> : <></>) : undefined} />

      {/* Pinned footer: Mark as done (outlined, left) · Save changes / Close (right). */}
      <PinnedFooter fallback="sticky">
        <div className="flex flex-col gap-2" data-testid="todo-popup-footer" data-dirty={dirty ? "true" : "false"}>
          {dirty && (
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5" role="status">
              <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden /> Unsaved changes
            </p>
          )}
          <ParentTickInline asking={guard.asking} answer={guard.answer} />
          <div className="flex gap-3">
            {task && (
              <TodoDoneButton t={t} onMarkDone={() => void t.markDone({
                saveFirst: async () => { if (patch && valid) await saveMut.mutateAsync(patch); }, title: form?.title,
              })} />
            )}
            <button
              type="button"
              onClick={() => void saveAndClose()}
              disabled={saveMut.isPending}
              className={cn(
                "flex-1 min-h-14 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60",
                dirty ? "bg-[#7cb342] text-white hover:bg-[#6a9c37]" : "bg-secondary text-foreground hover:bg-secondary/70",
              )}
            >
              {saveMut.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
              {saveMut.isPending ? "Saving…" : dirty ? "Save changes" : "Close"}
            </button>
          </div>
        </div>
      </PinnedFooter>
    </EditorDialog>
  );
}

/** The docked panel's edit page. Saves as you type (there's no Save to
 *  forget: Back, another list or a station screen can all take you away from
 *  it), with the state always showing. The server writes one "edited the
 *  task" line per sitting, not one per pause in typing. */
export function TodoEditForm({ task, t, onDone }: { task: TodoTask; t: TodoTaskState; onDone: () => void }) {
  // Anything that didn't reach the server last time (offline, the screen
  // reloaded mid-word) is put back and saved again.
  const { draft, setDraft, clearDraft } = useTodoEditDraft(task.id);
  // What the server has. Only what differs from it is sent.
  const saved = useRef<TodoForm>(todoFormFrom(task));
  const [form, setForm] = useState<TodoForm>(() => (draft ? applyEditDraft(saved.current, draft) : saved.current));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // One after another, never side by side: the last thing typed must win.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const auto = useAutosave<TodoForm>(next => {
    const run = queue.current.catch(() => undefined).then(async () => {
      const patch = todoAutosavePatch(saved.current, next);
      if (!patch) { clearDraft(); return; }
      try {
        await patchTodo(task.id, patch);
      } catch (err) {
        if (!mounted.current) {
          toast({ title: "Your changes didn't save", description: `“${task.title}” — they're kept. Open it and tap Edit to try again.`, variant: "destructive" });
        }
        throw err;
      }
      saved.current = { ...next, title: patch.title ?? saved.current.title };
      // Typed on while that was saving: that part is still a draft.
      if (latest.current === next) clearDraft();
      else setDraft({ base: saved.current, form: latest.current });
      t.invalidate();
    });
    queue.current = run;
    return run;
  });
  const latest = useRef(form);
  const change = (f: TodoForm) => {
    latest.current = f;
    setForm(f);
    setDraft({ base: saved.current, form: f });
    auto.schedule(f);
  };
  useEffect(() => {
    if (draft) auto.schedule(latest.current);
    // Once, for what was kept from last time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const valid = todoFormValid(form);
  return (
    <>
      <TodoFields compact form={form} onChange={change} onBlur={() => void auto.flush()}
        onEnter={() => void auto.flush()} />
      <PinnedFooter fallback="sticky">
        <div className="space-y-2">
          <div className="min-h-5 flex flex-wrap items-center gap-x-3">
            {!valid
              ? <span className="text-sm font-semibold text-destructive">It needs a title — “{saved.current.title}” is kept until you type one.</span>
              : <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}
          </div>
          <button type="button" onClick={() => { void auto.flush().then(ok => { if (ok) onDone(); }); }}
            className="w-full min-h-14 rounded-2xl bg-[#7cb342] text-white text-lg font-bold flex items-center justify-center gap-2 hover:bg-[#6a9c37]">
            <Check className="w-5 h-5" /> Done editing
          </button>
        </div>
      </PinnedFooter>
    </>
  );
}
