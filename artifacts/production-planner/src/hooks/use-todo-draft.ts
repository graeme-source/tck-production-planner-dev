/**
 * Half-typed to-do text that survives Back, switching lists, going to a
 * station and a reload (lib/todo-drafts.ts has the rules). Kept in memory and
 * in sessionStorage, per person; both the Layout's panel and the one inside
 * the Create Plan dialog read the same draft.
 */
import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
  EMPTY_CREATE_DRAFT, parseCreateDraft, parseEditDraft, parseTextDraft, todoDraftKey, type TodoCreateDraft, type TodoDraftSlot, type TodoEditDraft,
} from "@/lib/todo-drafts";

const memory = new Map<string, unknown>();
const listeners = new Set<() => void>();

function read<T>(key: string, parse: (raw: string | null) => T): T {
  if (memory.has(key)) return memory.get(key) as T;
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(key); } catch { /* private mode: memory only */ }
  const value = parse(raw);
  memory.set(key, value);
  return value;
}

function write<T>(key: string, value: T, empty: boolean) {
  memory.set(key, value);
  try {
    if (empty) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* memory only */ }
  listeners.forEach(l => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function useUserId(): number {
  const { state } = useAuth();
  return state.status === "authenticated" ? state.user.id : 0;
}

/** Text being typed: a comment, a sub-task to add, or the add box. */
export function useTodoTextDraft(slot: Extract<TodoDraftSlot, { kind: "comment" | "add" | "subtask" }>): [string, (v: string | ((cur: string) => string)) => void] {
  const key = todoDraftKey(useUserId(), slot);
  const value = useSyncExternalStore(subscribe, () => read(key, parseTextDraft));
  const set = useCallback((v: string | ((cur: string) => string)) => {
    const next = typeof v === "function" ? v(read(key, parseTextDraft)) : v;
    write(key, next, next === "");
  }, [key]);
  return [value, set];
}

/** A new to-do being filled in. */
export function useTodoCreateDraft(): { draft: TodoCreateDraft; setDraft: (d: TodoCreateDraft) => void; clearDraft: () => void } {
  const key = todoDraftKey(useUserId(), { kind: "create" });
  const draft = useSyncExternalStore(subscribe, () => read(key, parseCreateDraft));
  const setDraft = useCallback((d: TodoCreateDraft) => write(key, d, d === EMPTY_CREATE_DRAFT), [key]);
  const clearDraft = useCallback(() => write(key, EMPTY_CREATE_DRAFT, true), [key]);
  return { draft, setDraft, clearDraft };
}

/** An edit to a to-do on its way to the server (null = none). */
export function useTodoEditDraft(taskId: number): { draft: TodoEditDraft | null; setDraft: (d: TodoEditDraft) => void; clearDraft: () => void } {
  const key = todoDraftKey(useUserId(), { kind: "edit", taskId });
  const draft = useSyncExternalStore(subscribe, () => read(key, parseEditDraft));
  const setDraft = useCallback((d: TodoEditDraft) => write(key, d, false), [key]);
  const clearDraft = useCallback(() => write<TodoEditDraft | null>(key, null, true), [key]);
  return { draft, setDraft, clearDraft };
}
