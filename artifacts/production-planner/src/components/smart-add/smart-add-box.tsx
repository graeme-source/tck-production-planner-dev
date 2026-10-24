/**
 * The one "add" box for team lists, personal to-dos and station checklists
 * (Graeme, 2026-10-24: "all checklists use exactly the same logic").
 *
 * Type or say a line — "clean packing computer every Thursday cleaning
 * check", "ring the butcher next monday p1", "@Jane Miles check the seals".
 * While you type it shows what it has read (priority, repeat, date, person).
 * On Enter the server works out WHERE it goes (AI, with these rules always
 * winning), then it's added through that list's normal endpoint and a big
 * green card says exactly what was added, where, and when — with Undo.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, CalendarDays, CheckCircle2, Clock, Loader2, Plus, Repeat, Sparkles, Undo2, X } from "lucide-react";
import { parseSmartAdd, type RecurrenceRule } from "@workspace/recurrence";
import { cn } from "@/lib/utils";
import { DictateButton } from "@/components/dictate-button";
import { TEAM_LISTS_KEY } from "@/components/team-lists/team-lists-api";
import { londonDay } from "@/lib/day-rollover";
import {
  addPlacement, describeWhen, undoAdded,
  type AddedTask, type Placement, type SmartAddContext,
} from "./smart-add-api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PRIORITY_DOT: Record<number, string> = { 1: "bg-red-500", 2: "bg-orange-500", 3: "bg-blue-500", 4: "bg-muted-foreground/40" };

export function useSmartAddPeople() {
  return useQuery({
    queryKey: ["smart-add-people"],
    queryFn: async (): Promise<{ id: number; name: string }[]> => {
      const r = await fetch(`${BASE}/api/smart-add/people`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 10 * 60_000,
  });
}

export function SmartAddBox({
  context, placeholder = "Add a task", size = "lg", inputRef: externalRef, value, onValueChange, onAdded, className, autoFocus,
}: {
  context: SmartAddContext;
  placeholder?: string;
  size?: "lg" | "md";
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Controlled text, for callers that also read it (the to-do sheet's "more details"). */
  value?: string;
  onValueChange?: (v: string) => void;
  onAdded?: (added: AddedTask) => void;
  className?: string;
  autoFocus?: boolean;
}) {
  const [ownText, setOwnText] = useState("");
  const text = value ?? ownText;
  const setText = (v: string | ((cur: string) => string)) => {
    const next = typeof v === "function" ? v(text) : v;
    if (onValueChange) onValueChange(next); else setOwnText(next);
  };
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? ownRef;
  const qc = useQueryClient();
  const people = useSmartAddPeople();
  const today = londonDay(Date.now());
  const preview = useMemo(() => parseSmartAdd(text, today, people.data ?? []), [text, today, people.data]);
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<AddedTask[]>([]);

  useEffect(() => { setProblem(null); }, [text]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["todos"] });
    void qc.invalidateQueries({ queryKey: TEAM_LISTS_KEY });
  };

  const add = useMutation({
    mutationFn: async (line: string): Promise<AddedTask | { problem: string }> => {
      const r = await fetch(`${BASE}/api/smart-add/interpret`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: line, context }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      const placement = body as Placement;
      if (placement.problem) return { problem: placement.problem };
      return addPlacement(placement, context, today);
    },
    onSuccess: (res, line) => {
      if ("problem" in res) { setProblem(res.problem); return; }
      setText(cur => (cur.trim() === line ? "" : cur));
      setAdded(prev => [res, ...prev].slice(0, 3));
      refresh();
      onAdded?.(res);
      inputRef.current?.focus({ preventScroll: true });
    },
    onError: (e: Error) => setProblem(`Couldn't add it — ${e.message}. Your text is still here; try again.`),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const line = text.trim();
    if (!line || add.isPending) return;
    add.mutate(line);
  };

  const big = size === "lg";
  const hasPreview = !!(preview.priority || preview.rule || preview.date || preview.time || preview.mentions.length);

  return (
    <div className={cn("space-y-2", className)}>
      <form onSubmit={submit} className="flex gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          maxLength={500}
          enterKeyHint="done"
          autoFocus={autoFocus}
          className={cn(
            "flex-1 min-w-0 rounded-2xl border-2 border-border bg-card font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40",
            big ? "h-16 px-5 text-xl" : "h-12 px-3 text-base",
          )}
        />
        <DictateButton value={text} onChange={setText} context="title" />
        <button
          type="submit"
          disabled={!text.trim() || add.isPending}
          className={cn(
            "rounded-2xl bg-primary text-primary-foreground font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40 shadow-lg shadow-primary/20 flex-shrink-0",
            big ? "h-16 px-5 md:px-6 text-xl" : "h-12 px-4 text-base",
          )}
        >
          {add.isPending ? <Loader2 className={big ? "w-6 h-6 animate-spin" : "w-5 h-5 animate-spin"} /> : <Plus className={big ? "w-7 h-7" : "w-5 h-5"} />}
          Add
        </button>
      </form>

      {add.isPending && (
        <p className="text-sm text-primary font-semibold flex items-center gap-2 px-1"><Sparkles className="w-4 h-4" /> Working out where it goes…</p>
      )}

      {!add.isPending && hasPreview && (
        <p className="text-sm text-primary font-semibold flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          <span>“{preview.title || "…"}”</span>
          {preview.mentions.map(m => <span key={m.id} className="inline-flex items-center gap-1"><AtSign className="w-4 h-4" /> {m.name}’s list</span>)}
          {preview.priority && <span className="inline-flex items-center gap-1"><span className={cn("w-2.5 h-2.5 rounded-full", PRIORITY_DOT[preview.priority])} /> P{preview.priority}</span>}
          {preview.rule && <span className="inline-flex items-center gap-1"><Repeat className="w-4 h-4" /> {describeWhen({ rule: preview.rule, date: null, dateKind: null, time: null })}</span>}
          {preview.date && <span className="inline-flex items-center gap-1"><CalendarDays className="w-4 h-4" /> {describeWhen({ rule: null, date: preview.date, dateKind: preview.dateKind, time: null })}</span>}
          {preview.time && <span className="inline-flex items-center gap-1"><Clock className="w-4 h-4" /> {preview.time}</span>}
        </p>
      )}

      {!add.isPending && !hasPreview && !text.trim() && big && (
        <p className="text-xs text-muted-foreground px-1">
          Try “clean packing computer every Thursday, cleaning check”, “ring the butcher next Monday p1”, or “@Jane Miles check the door seals”.
        </p>
      )}

      {problem && (
        <div role="alert" className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-base font-semibold text-amber-900 dark:text-amber-200">
          {problem}
        </div>
      )}

      {added.map(a => (
        <AddedCard key={`${a.kind}-${a.id}`} added={a} onDismiss={() => setAdded(prev => prev.filter(x => x !== a))}
          onUndone={() => { setAdded(prev => prev.filter(x => x !== a)); refresh(); }} />
      ))}
    </div>
  );
}

/** "✓ Added to the Packing cleaning check — every Thursday." Stays 12s. */
function AddedCard({ added, onDismiss, onUndone }: { added: AddedTask; onDismiss: () => void; onUndone: () => void }) {
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(onDismiss, 12_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const undo = async () => {
    setUndoing(true);
    try { await undoAdded(added); onUndone(); }
    catch (e) { setError((e as Error).message); setUndoing(false); }
  };
  return (
    <div role="status" className="rounded-2xl border-2 border-primary bg-primary/10 px-4 py-3 flex items-start gap-3 animate-in fade-in slide-in-from-top-1">
      <CheckCircle2 className="w-8 h-8 text-primary flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-lg font-bold leading-snug break-words">Added “{added.title}”</p>
        <p className="text-base font-semibold text-foreground/80">
          to {added.destinationLabel} · {added.when}
        </p>
        {error && <p className="text-sm text-red-600 mt-1">Couldn't undo — {error}</p>}
      </div>
      <button type="button" onClick={undo} disabled={undoing}
        className="h-11 px-3 rounded-xl border-2 border-primary/40 text-primary font-bold inline-flex items-center gap-1.5 hover:bg-primary/10 disabled:opacity-50 flex-shrink-0">
        {undoing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />} Undo
      </button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="h-11 w-11 rounded-xl hover:bg-primary/10 inline-flex items-center justify-center flex-shrink-0">
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

export type { RecurrenceRule };
