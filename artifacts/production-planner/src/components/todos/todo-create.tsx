/** Add a to-do with all its details. */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { EditorDialog } from "@/components/recipe-editor/editor-dialog";
import { PinnedFooter } from "@/components/ui/pinned-save-bar";
import { toast } from "@/hooks/use-toast";
import {
  EMPTY_TODO_FORM, todoCreateBody, todoEditPatch, todoFormValid, type TodoEditable, type TodoForm,
} from "@/lib/todo-edit";
import { cn } from "@/lib/utils";
import { BASE, jsonOrThrow, post, type AppUserRow, type TodoTask } from "./api";
import { TodoFields } from "./todo-fields";

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

  const { data: users } = useQuery({
    queryKey: ["todo-users"],
    queryFn: async (): Promise<AppUserRow[]> => jsonOrThrow(await fetch(`${BASE}/api/users`, { credentials: "include" })),
    staleTime: 5 * 60_000,
    enabled: canManage,
  });
  const activeUsers = (users ?? []).filter(u => u.isActive);

  const saveMut = useMutation({
    mutationFn: (): Promise<TodoTask> => post("/api/todos", todoCreateBody(form, assigneeId)),
    onSuccess: (saved) => {
      toast({ title: assigneeId === meId ? "Added to your list" : "Added to their list — they'll be shown it", description: saved.title });
      onAdded(saved);
    },
    onError: (e: Error) => toast({ title: "Couldn't add the task", description: `${e.message} — it's all still here.`, variant: "destructive" }),
  });
  const save = () => { if (valid && !saveMut.isPending) saveMut.mutate(); };

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
        {/* Who — managers only, create only (reassigning an existing task is
            a delete-and-recreate; keeps the acknowledge story honest). */}
        {canManage && (
          <div>
            <label className="block text-lg font-bold mb-2">Who's it for?</label>
            <select
              value={assigneeId}
              onChange={e => setAssigneeId(Number(e.target.value))}
              className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value={meId}>Me</option>
              {activeUsers.filter(u => u.id !== meId).map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        )}
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
          <button
            type="button"
            onClick={save}
            disabled={!valid || saveMut.isPending}
            className={cn(
              "flex-1 min-h-14 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 transition-colors",
              valid ? "bg-[#7cb342] text-white hover:bg-[#6a9c37] disabled:opacity-60" : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            {saveMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
            {saveMut.isPending ? "Adding…" : "Add it"}
          </button>
        </div>
      </PinnedFooter>
    </EditorDialog>
  );
}
