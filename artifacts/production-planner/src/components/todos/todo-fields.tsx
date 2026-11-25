/** The fields, shared by editing a to-do and "add with more details". */
import { useNoScrollAutoFocus } from "@/hooks/use-modal-scroll";
import type { TodoForm } from "@/lib/todo-edit";
import { cn } from "@/lib/utils";
import { PRIORITY_META, type TodoPriority } from "./api";

export function TodoFields({ form, onChange, autoFocusTitle = false, onEnter }: {
  form: TodoForm;
  onChange: (f: TodoForm) => void;
  autoFocusTitle?: boolean;
  /** Enter in the title box — saves. */
  onEnter?: () => void;
}) {
  const titleRef = useNoScrollAutoFocus<HTMLInputElement>(autoFocusTitle);
  const set = (p: Partial<TodoForm>) => onChange({ ...form, ...p });
  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="todo-title" className="block text-lg font-bold mb-2">What needs doing?</label>
        <input
          id="todo-title"
          ref={titleRef}
          value={form.title}
          onChange={e => set({ title: e.target.value })}
          onKeyDown={e => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }}
          placeholder="e.g. Deep-clean the pass fridge"
          maxLength={300}
          className="w-full h-16 px-5 rounded-2xl border-2 border-border bg-card text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label htmlFor="todo-notes" className="block text-lg font-bold mb-2">Instructions / notes <span className="font-normal text-muted-foreground">(optional)</span></label>
        <textarea
          id="todo-notes"
          value={form.notes}
          onChange={e => set({ notes: e.target.value })}
          rows={4}
          placeholder="Anything they need to know to do it right."
          className="w-full px-5 py-4 rounded-2xl border-2 border-border bg-card text-lg leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label htmlFor="todo-url" className="block text-lg font-bold mb-2">Link <span className="font-normal text-muted-foreground">(optional — SOP, form, page)</span></label>
        <input
          id="todo-url"
          value={form.url}
          onChange={e => set({ url: e.target.value })}
          placeholder="https://…"
          inputMode="url"
          className="w-full h-14 px-5 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <p className="block text-lg font-bold mb-2">Priority</p>
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(PRIORITY_META) as TodoPriority[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => set({ priority: p })}
              aria-pressed={form.priority === p}
              className={cn(
                "h-14 rounded-2xl border-2 text-base md:text-lg font-bold transition-all",
                form.priority === p ? PRIORITY_META[p].solid : "border-border bg-card hover:bg-secondary/50",
              )}
            >
              {PRIORITY_META[p].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="todo-do-on" className="block text-lg font-bold mb-2">Do it on <span className="font-normal text-muted-foreground">(optional)</span></label>
          <input
            id="todo-do-on"
            type="date"
            value={form.scheduledFor}
            onChange={e => set({ scheduledFor: e.target.value })}
            className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label htmlFor="todo-due" className="block text-lg font-bold mb-2">Due by <span className="font-normal text-muted-foreground">(optional)</span></label>
          <input
            id="todo-due"
            type="date"
            value={form.dueDate}
            onChange={e => set({ dueDate: e.target.value })}
            className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>
    </div>
  );
}
