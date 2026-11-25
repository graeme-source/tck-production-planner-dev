/**
 * Add a to-do with all its details: the pop-up over the full-screen list
 * (TodoCreateDialog) and the docked panel's page (TodoCreatePage). Same
 * fields, same save.
 */
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useTodoCreateDraft } from "@/hooks/use-todo-draft";
import { EditorDialog } from "@/components/recipe-editor/editor-dialog";
import { PinnedFooter } from "@/components/ui/pinned-save-bar";
import { toast } from "@/hooks/use-toast";
import {
  EMPTY_TODO_FORM, todoCreateBody, todoEditPatch, todoFormValid, type TodoEditable, type TodoForm,
} from "@/lib/todo-edit";
import { createDraftStarted } from "@/lib/todo-drafts";
import { cn } from "@/lib/utils";
import { post, useTodoPeople, type TodoTask } from "./api";
import { TodoFields } from "./todo-fields";

/** Who it's for — create only (reassigning an existing task is a
 *  delete-and-recreate; keeps the acknowledge story honest). */
function WhoFor({ meId, value, onChange, compact = false }: { meId: number; value: number; onChange: (id: number) => void; compact?: boolean }) {
  const id = useId();
  const people = useTodoPeople(true);
  return (
    <div>
      <label htmlFor={id} className={cn("block font-bold", compact ? "text-base mb-1.5" : "text-lg mb-2")}>Who's it for?</label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={cn("w-full border-2 border-border bg-card font-bold focus:outline-none focus:ring-2 focus:ring-primary/40",
          compact ? "h-12 px-2 rounded-xl text-base" : "h-14 px-4 rounded-2xl text-lg")}
      >
        <option value={meId}>Me</option>
        {people.filter(u => u.id !== meId).map(u => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
    </div>
  );
}

function useSaveNewTodo({ meId, form, assigneeId, onAdded }: { meId: number; form: TodoForm; assigneeId: number; onAdded: (task: TodoTask) => void }) {
  const saveMut = useMutation({
    mutationFn: (): Promise<TodoTask> => post("/api/todos", todoCreateBody(form, assigneeId)),
    onSuccess: (saved) => {
      toast({ title: assigneeId === meId ? "Added to your list" : "Added to their list — they'll be shown it", description: saved.title });
      onAdded(saved);
    },
    onError: (e: Error) => toast({ title: "Couldn't add the task", description: `${e.message} — it's all still here.`, variant: "destructive" }),
  });
  return { saving: saveMut.isPending, save: () => { if (todoFormValid(form) && !saveMut.isPending) saveMut.mutate(); } };
}

function AddItButton({ valid, saving, onClick }: { valid: boolean; saving: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!valid || saving}
      className={cn(
        "flex-1 min-h-14 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 transition-colors",
        valid ? "bg-[#7cb342] text-white hover:bg-[#6a9c37] disabled:opacity-60" : "bg-muted text-muted-foreground cursor-not-allowed",
      )}
    >
      {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
      {saving ? "Adding…" : "Add it"}
    </button>
  );
}

/** The docked panel's "New to-do" page. Back keeps everything typed (the list
 *  then offers to carry on with it); only Discard, or adding it, clears it. */
export function TodoCreatePage({ meId, canManage, onDiscard, onAdded }: {
  meId: number;
  canManage: boolean;
  onDiscard: () => void;
  onAdded: (task: TodoTask) => void;
}) {
  const { draft, setDraft, clearDraft } = useTodoCreateDraft();
  const assigneeId = canManage ? draft.assigneeId ?? meId : meId;
  const { saving, save } = useSaveNewTodo({ meId, form: draft.form, assigneeId, onAdded: task => { clearDraft(); onAdded(task); } });
  const [startedBlank] = useState(draft.form.title === "");
  return (
    <>
      <div className="space-y-4">
        {canManage && <WhoFor compact meId={meId} value={assigneeId} onChange={id => setDraft({ ...draft, assigneeId: id })} />}
        <TodoFields compact form={draft.form} onChange={form => setDraft({ ...draft, form })} autoFocusTitle={startedBlank} onEnter={save} />
      </div>
      <PinnedFooter fallback="sticky">
        <div className="flex gap-2">
          {createDraftStarted(draft) && (
            <button type="button" onClick={() => { clearDraft(); onDiscard(); }}
              className="min-h-14 px-4 rounded-2xl border-2 border-border bg-card text-base font-bold hover:bg-secondary/50">
              Discard
            </button>
          )}
          <AddItButton valid={todoFormValid(draft.form)} saving={saving} onClick={save} />
        </div>
      </PinnedFooter>
    </>
  );
}

export function TodoCreateDialog({ meId, canManage, defaultAssigneeId, initialTitle, focusAfterClose, onClose, onAdded }: {
  meId: number;
  canManage: boolean;
  defaultAssigneeId: number;
  initialTitle: string;
  /** The add box — the cursor goes back there, ready for the next one. */
  focusAfterClose: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onAdded: (task: TodoTask) => void;
}) {
  const [form, setForm] = useState<TodoForm>({ ...EMPTY_TODO_FORM, title: initialTitle });
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId);
  const start: TodoEditable = { title: initialTitle, notes: null, url: null, priority: "normal", scheduled_for: null, due_date: null };
  const dirty = todoEditPatch(start, form) !== null || assigneeId !== defaultAssigneeId;
  const valid = todoFormValid(form);

  const { saving, save } = useSaveNewTodo({ meId, form, assigneeId, onAdded });

  return (
    <EditorDialog
      open
      onClose={onClose}
      title={<><Plus className="w-6 h-6 text-primary" /> New to-do</>}
      dirty={dirty}
      onSaveRequest={save}
      entityLabel="to-do"
      widthClassName="sm:max-w-3xl"
      noAutoFocus
      onCloseAutoFocus={e => { e.preventDefault(); focusAfterClose.current?.focus({ preventScroll: true }); }}
    >
      <div className="space-y-5 pt-4">
        {canManage && <WhoFor meId={meId} value={assigneeId} onChange={setAssigneeId} />}
        <TodoFields form={form} onChange={setForm} autoFocusTitle={!initialTitle} onEnter={save} />
      </div>
      <PinnedFooter fallback="sticky">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-14 px-5 rounded-2xl border-2 border-border bg-card text-lg font-bold hover:bg-secondary/50 transition-colors"
          >
            Cancel
          </button>
          <AddItButton valid={valid} saving={saving} onClick={save} />
        </div>
      </PinnedFooter>
    </EditorDialog>
  );
}
