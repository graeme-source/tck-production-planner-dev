/** The fields, shared by editing a to-do and "add with more details". */
import { useId } from "react";
import { useNoScrollAutoFocus } from "@/hooks/use-modal-scroll";
import type { TodoForm } from "@/lib/todo-edit";
import { cn } from "@/lib/utils";
import { GrowingTitle } from "./growing-title";
import { PRIORITY_META, type TodoPriority } from "./api";

export function TodoFields({ form, onChange, autoFocusTitle = false, onEnter, onBlur, compact = false }: {
  form: TodoForm;
  onChange: (f: TodoForm) => void;
  autoFocusTitle?: boolean;
  /** Enter in the title box — saves. */
  onEnter?: () => void;
  /** Leaving any text box — where it saves itself, save now. */
  onBlur?: () => void;
  /** Narrow: in the docked panel (whatever the screen's width). */
  compact?: boolean;
}) {
  // Two can be on screen at once (the panel, and the one in Create Plan).
  const id = useId();
  const titleRef = useNoScrollAutoFocus<HTMLInputElement>(autoFocusTitle);
  const set = (p: Partial<TodoForm>) => onChange({ ...form, ...p });
  const label = cn("block font-bold", compact ? "text-base mb-1.5" : "text-lg mb-2");
  const box = cn("w-full border-2 border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40",
    compact ? "rounded-xl px-3" : "rounded-2xl");
  return (
    <div className={compact ? "space-y-4" : "space-y-5"}>
      <div>
        <label htmlFor={`${id}-title`} className={label}>What needs doing?</label>
        {compact ? (
          <GrowingTitle
            id={`${id}-title`}
            value={form.title}
            onChange={title => set({ title })}
            onBlur={onBlur}
            onEnter={onEnter}
            autoFocus={autoFocusTitle}
            placeholder="e.g. Deep-clean the pass fridge"
            className={cn(box, "min-h-14 py-3.5 text-lg font-semibold leading-snug")}
          />
        ) : (
          <input
            id={`${id}-title`}
            ref={titleRef}
            value={form.title}
            onChange={e => set({ title: e.target.value })}
            onBlur={onBlur}
            onKeyDown={e => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }}
            placeholder="e.g. Deep-clean the pass fridge"
            maxLength={300}
            className={cn(box, "h-16 px-5 text-xl font-semibold")}
          />
        )}
      </div>

      <div>
        <label htmlFor={`${id}-notes`} className={label}>Instructions / notes <span className="font-normal text-muted-foreground">(optional)</span></label>
        <textarea
          id={`${id}-notes`}
          value={form.notes}
          onChange={e => set({ notes: e.target.value })}
          onBlur={onBlur}
          rows={4}
          placeholder="Anything they need to know to do it right."
          className={cn(box, "leading-relaxed", compact ? "py-3 text-base" : "px-5 py-4 text-lg")}
        />
      </div>

      <div>
        <label htmlFor={`${id}-url`} className={label}>Link <span className="font-normal text-muted-foreground">(optional — SOP, form, page)</span></label>
        <input
          id={`${id}-url`}
          value={form.url}
          onChange={e => set({ url: e.target.value })}
          onBlur={onBlur}
          placeholder="https://…"
          inputMode="url"
          className={cn(box, compact ? "h-12 text-base" : "h-14 px-5 text-lg")}
        />
      </div>

      <div>
        <p className={label}>Priority</p>
        <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-4")}>
          {(Object.keys(PRIORITY_META) as TodoPriority[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => set({ priority: p })}
              aria-pressed={form.priority === p}
              className={cn(
                "border-2 font-bold transition-all",
                compact ? "h-12 rounded-xl text-base" : "h-14 rounded-2xl text-base md:text-lg",
                form.priority === p ? PRIORITY_META[p].solid : "border-border bg-card hover:bg-secondary/50",
              )}
            >
              {PRIORITY_META[p].label}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("grid grid-cols-1 gap-4", !compact && "sm:grid-cols-2")}>
        <div>
          <label htmlFor={`${id}-do-on`} className={label}>Do it on <span className="font-normal text-muted-foreground">(optional)</span></label>
          <input
            id={`${id}-do-on`}
            type="date"
            value={form.scheduledFor}
            onChange={e => set({ scheduledFor: e.target.value })}
            onBlur={onBlur}
            className={cn(box, "min-w-0 font-semibold", compact ? "h-12 text-base" : "h-14 px-4 text-lg")}
          />
        </div>
        <div>
          <label htmlFor={`${id}-due`} className={label}>Due by <span className="font-normal text-muted-foreground">(optional)</span></label>
          <input
            id={`${id}-due`}
            type="date"
            value={form.dueDate}
            onChange={e => set({ dueDate: e.target.value })}
            onBlur={onBlur}
            className={cn(box, "min-w-0 font-semibold", compact ? "h-12 text-base" : "h-14 px-4 text-lg")}
          />
        </div>
      </div>
    </div>
  );
}
