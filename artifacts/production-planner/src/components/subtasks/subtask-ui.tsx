/**
 * Sub-tasks on screen (Graeme, 25 Nov 2026) — shared by team lists and
 * personal to-dos. The rules (progress, the parent-tick question) live in
 * lib/subtasks; this is only how they look.
 *
 *   SubtaskProgressChip  "3 of 7" on a to-do; "7 sub-tasks" on a team-list master
 *   SubtaskList          the steps, in order — with big tick circles on a
 *                        to-do, read-only on a team list
 *   SubtaskEditor        add / edit / reorder / remove, every field
 *                        autosaving with its save state showing
 *   useParentTickGuard   "Tick the 4 left as well?" before a to-do with
 *                        unticked sub-tasks is ticked off; ParentTickPrompt
 *                        (a pop-up) or ParentTickInline (inside a dialog)
 */
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Circle, ExternalLink, ListChecks, Loader2, Plus, StickyNote, Trash2, X,
} from "lucide-react";
import {
  moveId, parentTickDecision, progressLabel, subtaskCountLabel, subtaskProgress,
  type ParentTickChoice, type ParentTickDecision, type TickableSubtask,
} from "@workspace/subtasks";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { resolveTodoLink } from "@/lib/todo-link";

/** One sub-task as either list sends it (camelCase or the to-dos' snake_case
 *  is mapped by the caller). */
export interface SubtaskView {
  id: number;
  title: string;
  notes: string | null;
  url: string | null;
  /** Ticks exist on to-dos only; undefined on a team-list master. */
  doneAt?: string | null;
  doneByName?: string | null;
}

// ── Chips ──────────────────────────────────────────────────────────────────

/** "3 of 7" (to-do) or "7 sub-tasks" (team list). Tapping it toggles the list
 *  when `onToggle` is given. Nothing when there are none. */
export function SubtaskProgressChip({ subtasks, ticks, open, onToggle, size = "md" }: {
  subtasks: readonly SubtaskView[];
  /** true on a to-do ("3 of 7"), false on a team-list master ("7 sub-tasks"). */
  ticks: boolean;
  open?: boolean;
  onToggle?: () => void;
  size?: "sm" | "md";
}) {
  if (subtasks.length === 0) return null;
  const p = subtaskProgress(subtasks);
  const label = ticks ? progressLabel(p) : subtaskCountLabel(p.total);
  const complete = ticks && p.left === 0;
  const cls = cn(
    "inline-flex items-center gap-1.5 rounded-full font-semibold border-2",
    size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm",
    complete ? "border-emerald-500/50 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-border bg-secondary/60",
  );
  const inner = (
    <>
      <ListChecks className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} aria-hidden />
      {label}
      {onToggle && (open ? <ChevronDown className="w-4 h-4" aria-hidden /> : <ChevronRight className="w-4 h-4" aria-hidden />)}
    </>
  );
  if (!onToggle) return <span className={cls}>{inner}</span>;
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onToggle(); }} aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} sub-tasks (${label})`} className={cn(cls, "min-h-[36px] hover:bg-secondary")}>
      {inner}
    </button>
  );
}

// ── The list ───────────────────────────────────────────────────────────────

function SubtaskTitle({ s, done }: { s: SubtaskView; done: boolean }) {
  const cls = cn("text-base md:text-lg font-semibold leading-snug break-words", done && "line-through text-muted-foreground");
  if (!s.url) return <span className={cls}>{s.title}</span>;
  // A plain anchor, like the to-do link button: a full page load also closes
  // the to-do sheet, which a client-side navigate would leave open on top.
  const { href, external } = resolveTodoLink(s.url);
  return (
    <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} onClick={e => e.stopPropagation()}
      className={cn(cls, "underline decoration-2 underline-offset-4 text-primary inline-flex items-center gap-1")}>
      {s.title}{external && <ExternalLink className="w-4 h-4 shrink-0" />}
    </a>
  );
}

/** The steps in order. With `onTick` each has a big tick circle (a to-do);
 *  without, they're read-only (a team-list master). */
export function SubtaskList({ subtasks, onTick, busyId, compact = false }: {
  subtasks: readonly SubtaskView[];
  onTick?: (s: SubtaskView, done: boolean) => void;
  busyId?: number | null;
  compact?: boolean;
}) {
  if (subtasks.length === 0) return null;
  return (
    <ol className={cn("space-y-1.5", compact && "space-y-1")}>
      {subtasks.map((s, i) => {
        const done = s.doneAt != null;
        return (
          <li key={s.id} className={cn("rounded-xl border-2 border-border bg-background flex items-start", done && "bg-muted/40")}>
            {onTick ? (
              <button type="button" onClick={e => { e.stopPropagation(); onTick(s, !done); }} disabled={busyId === s.id}
                aria-label={done ? `Untick ${s.title}` : `Tick ${s.title}`}
                className="w-14 min-h-[52px] shrink-0 flex items-center justify-center hover:bg-primary/5 disabled:opacity-60">
                {busyId === s.id ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  : done ? <span className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center"><Check className="w-5 h-5" /></span>
                    : <Circle className="w-8 h-8 text-muted-foreground/60" />}
              </button>
            ) : (
              <span className="w-10 min-h-[44px] shrink-0 flex items-center justify-center text-sm font-bold text-muted-foreground tabular-nums">{i + 1}</span>
            )}
            <div className={cn("min-w-0 flex-1 pr-3", compact ? "py-2" : "py-2.5")}>
              <SubtaskTitle s={s} done={done} />
              {s.notes && <p className="text-sm text-muted-foreground whitespace-pre-line mt-0.5">{s.notes}</p>}
              {done && s.doneByName && <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">Ticked by {s.doneByName.split(" ")[0]}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── The editor ─────────────────────────────────────────────────────────────

export interface SubtaskEditorApi {
  add: (title: string) => Promise<unknown>;
  patch: (id: number, data: { title: string; notes: string | null; url: string | null }) => Promise<unknown>;
  remove: (id: number) => Promise<unknown>;
  reorder: (ids: number[]) => Promise<unknown>;
}

const inputCls = "w-full h-12 rounded-xl border-2 border-border bg-background px-3 text-base focus:outline-none focus:border-primary";

function EditorRow({ s, first, last, api, onMove, onRemoved, busy }: {
  s: SubtaskView; first: boolean; last: boolean; api: SubtaskEditorApi;
  onMove: (delta: -1 | 1) => void; onRemoved: () => void; busy: boolean;
}) {
  const [form, setForm] = useState({ title: s.title, notes: s.notes, url: s.url });
  const [details, setDetails] = useState(!!(s.notes || s.url));
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const auto = useAutosave<typeof form>(v => api.patch(s.id, v));
  function change(patch: Partial<typeof form>) {
    const next = { ...form, ...patch };
    setForm(next);
    if (next.title.trim()) auto.schedule(next);
  }
  async function remove() {
    setRemoving(true);
    setRemoveError(null);
    auto.discard();
    try { await api.remove(s.id); onRemoved(); } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Couldn't remove it");
      setRemoving(false);
    }
  }
  return (
    <li className="rounded-xl border-2 border-border bg-card p-2 space-y-2">
      <div className="flex items-center gap-1.5">
        <input value={form.title} onChange={e => change({ title: e.target.value })} onBlur={() => { if (form.title.trim()) void auto.flush(); }}
          className={inputCls} aria-label="Sub-task" maxLength={300} />
        <button type="button" onClick={() => setDetails(d => !d)} aria-pressed={details} title="Note or link"
          aria-label={`Note or link for ${form.title}`}
          className={cn("w-11 h-11 shrink-0 rounded-xl border-2 flex items-center justify-center", details || form.notes || form.url ? "border-primary/50 text-primary" : "border-border text-muted-foreground")}>
          <StickyNote className="w-5 h-5" />
        </button>
        <button type="button" onClick={() => onMove(-1)} disabled={first || busy} aria-label={`Move ${form.title} up`}
          className="w-11 h-11 shrink-0 rounded-xl border-2 border-border flex items-center justify-center disabled:opacity-30"><ArrowUp className="w-5 h-5" /></button>
        <button type="button" onClick={() => onMove(1)} disabled={last || busy} aria-label={`Move ${form.title} down`}
          className="w-11 h-11 shrink-0 rounded-xl border-2 border-border flex items-center justify-center disabled:opacity-30"><ArrowDown className="w-5 h-5" /></button>
        <button type="button" onClick={() => void remove()} disabled={removing} aria-label={`Remove ${form.title}`}
          className="w-11 h-11 shrink-0 rounded-xl border-2 border-red-200 dark:border-red-900 text-red-600 flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50">
          {removing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
        </button>
      </div>
      {details && (
        <div className="space-y-2 pl-1">
          <textarea value={form.notes ?? ""} onChange={e => change({ notes: e.target.value || null })} onBlur={() => void auto.flush()}
            rows={2} placeholder="How to do it (optional)" aria-label={`Note for ${form.title}`}
            className="w-full rounded-xl border-2 border-border bg-background p-3 text-base focus:outline-none focus:border-primary" />
          <input value={form.url ?? ""} onChange={e => change({ url: e.target.value || null })} onBlur={() => void auto.flush()}
            placeholder="Link — /orders or https://… (optional)" aria-label={`Link for ${form.title}`} inputMode="url" className={inputCls} />
        </div>
      )}
      <div className="flex items-center gap-2 min-h-[20px] pl-1">
        {form.title.trim() === "" ? <span className="text-sm text-red-600">A sub-task needs a title.</span> : <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}
        {removeError && <span className="text-sm text-red-600">{removeError}</span>}
      </div>
    </li>
  );
}

/** Add, edit, reorder and remove sub-tasks. Every field autosaves with its
 *  state showing; `onChanged` runs after an add, remove or reorder so the
 *  caller can refresh its data. */
export function SubtaskEditor({ subtasks, api, onChanged, hint }: {
  subtasks: readonly SubtaskView[];
  api: SubtaskEditorApi;
  onChanged: () => void;
  hint?: ReactNode;
}) {
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = subtasks.map(s => s.id);

  async function add() {
    const t = title.trim();
    if (!t || adding) return;
    setAdding(true);
    setError(null);
    try {
      await api.add(t);
      setTitle("");
      onChanged();
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add it");
    } finally {
      setAdding(false);
    }
  }
  async function move(id: number, delta: -1 | 1) {
    setOrdering(true);
    setError(null);
    try { await api.reorder(moveId(ids, id, delta)); onChanged(); } catch (err) {
      setError(err instanceof Error ? `Order didn't save — ${err.message}` : "Order didn't save");
    } finally { setOrdering(false); }
  }

  return (
    <div className="space-y-2">
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {subtasks.length > 0 && (
        <ol className="space-y-2">
          {subtasks.map((s, i) => (
            <EditorRow key={s.id} s={s} first={i === 0} last={i === subtasks.length - 1} api={api} busy={ordering}
              onMove={d => void move(s.id, d)} onRemoved={onChanged} />
          ))}
        </ol>
      )}
      {ordering && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Saving order…</p>}
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void add(); }}>
        <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)} placeholder="Add a sub-task…"
          className={inputCls} aria-label="New sub-task" maxLength={300} />
        <button type="submit" disabled={!title.trim() || adding}
          className="h-12 px-4 shrink-0 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center gap-1.5 disabled:opacity-40">
          {adding ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />} Add
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ── "Tick the 4 left as well?" ─────────────────────────────────────────────

type Asking = { decision: Extract<ParentTickDecision, { kind: "ask" }>; title: string; resolve: (c: ParentTickChoice | null) => void };

/** Before ticking a to-do off: `choose` resolves straight away (undefined)
 *  when nothing is left, otherwise once the person answers — "tick_all",
 *  "leave", or null if they backed out. Render `asking` with
 *  ParentTickPrompt (a pop-up) or ParentTickInline (inside a dialog). */
export function useParentTickGuard() {
  const [asking, setAsking] = useState<Asking | null>(null);
  function choose(subtasks: readonly TickableSubtask[] | null | undefined, title: string): Promise<ParentTickChoice | null | undefined> {
    const decision = parentTickDecision(subtasks);
    if (decision.kind === "tick") return Promise.resolve(undefined);
    return new Promise(resolve => setAsking({ decision, title, resolve }));
  }
  const answer = (c: ParentTickChoice | null) => {
    asking?.resolve(c);
    setAsking(null);
  };
  return { choose, asking, answer };
}

function Choices({ asking, answer }: { asking: Asking; answer: (c: ParentTickChoice | null) => void }) {
  return (
    <div className="grid gap-2">
      <button type="button" onClick={() => answer("tick_all")} autoFocus
        className="min-h-14 px-4 rounded-2xl bg-[#7cb342] text-white text-lg font-bold flex items-center justify-center gap-2 hover:bg-[#6a9c37]">
        <Check className="w-5 h-5" /> {asking.decision.tickAllLabel}
      </button>
      <button type="button" onClick={() => answer("leave")}
        className="min-h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold hover:bg-secondary/60">
        {asking.decision.leaveLabel}
      </button>
      <button type="button" onClick={() => answer(null)}
        className="min-h-12 px-4 rounded-2xl text-base font-semibold text-muted-foreground hover:bg-secondary/60">
        Not yet — keep it open
      </button>
    </div>
  );
}

/** The question as a pop-up: X, backdrop and Escape all mean "not yet". */
export function ParentTickPrompt({ asking, answer }: { asking: Asking | null; answer: (c: ParentTickChoice | null) => void }) {
  if (!asking) return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-3" style={{ pointerEvents: "auto" }}
      onClick={() => answer(null)} onKeyDown={e => { if (e.key === "Escape") answer(null); }}>
      <div role="dialog" aria-modal="true" aria-label={asking.decision.question} onClick={e => e.stopPropagation()}
        className="bg-background border-2 border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-xl font-bold">{asking.decision.question}</h2>
            <p className="text-base text-muted-foreground break-words">{asking.title}</p>
          </div>
          <button type="button" onClick={() => answer(null)} aria-label="Close" className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center shrink-0">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain p-5">
          <Choices asking={asking} answer={answer} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The same question inside a dialog (e.g. the to-do pop-up's footer), where
 *  a second pop-up on top would fight the dialog for clicks. */
export function ParentTickInline({ asking, answer }: { asking: Asking | null; answer: (c: ParentTickChoice | null) => void }) {
  if (!asking) return null;
  return (
    <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2" role="group" aria-label={asking.decision.question}>
      <p className="text-lg font-bold">{asking.decision.question}</p>
      <Choices asking={asking} answer={answer} />
    </div>
  );
}
