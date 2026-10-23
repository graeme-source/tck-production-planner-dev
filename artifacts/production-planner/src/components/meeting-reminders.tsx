/**
 * Standing morning-meeting reminders (Graeme, 23 Oct 2026 — objective E).
 * One list that shows on EVERY meeting until someone removes it, like the
 * open safety issues. Added from the meeting prep page or on the Reminders
 * slide itself. API: /api/meeting-reminders (migration 0250).
 *
 *   StandingRemindersCard   — prep page: quick-add box + the list
 *   StandingRemindersSlide  — the slide the room sees, with add/remove
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Loader2, Plus, X, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["meeting-reminders"] as const;

export interface StandingReminder {
  id: number;
  text: string;
  forWhom: string | null;
  startsOn: string;
  createdByName: string | null;
  createdAt: string;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/meeting-reminders${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(err?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function useStandingReminders() {
  return useQuery<{ today: string; reminders: StandingReminder[] }>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/meeting-reminders`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

/** Managers and admins add and remove reminders (the server checks too). */
export function useCanEditReminders(): boolean {
  const { state } = useAuth();
  return state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");
}

export function useReminderActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  const add = useMutation({
    mutationFn: (v: { text: string; forWhom: string | null }) => call<StandingReminder>("", v),
    onSuccess: refresh,
  });
  const addMany = useMutation({
    mutationFn: (items: Array<{ text: string }>) => call<{ added: StandingReminder[] }>("/bulk", { items }),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: (id: number) => call<StandingReminder>(`/${id}/restore`, {}),
    onSuccess: () => { refresh(); toast({ title: "Reminder put back" }); },
    onError: (e: Error) => toast({ title: "Couldn't put it back", description: e.message, variant: "destructive" }),
  });
  // One tap removes; the toast carries Undo for the slip of a finger.
  const remove = useMutation({
    mutationFn: (r: StandingReminder) => call<{ ok: true }>(`/${r.id}/remove`, {}),
    onMutate: async (r) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<{ today: string; reminders: StandingReminder[] }>(KEY);
      if (prev) qc.setQueryData(KEY, { ...prev, reminders: prev.reminders.filter(x => x.id !== r.id) });
      return { prev };
    },
    onError: (e: Error, _r, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast({ title: "Couldn't remove the reminder", description: e.message, variant: "destructive" });
    },
    onSuccess: (_d, r) => {
      toast({
        title: "Reminder removed",
        description: r.text,
        action: <ToastAction altText="Undo" onClick={() => restore.mutate(r.id)}>Undo</ToastAction>,
      });
    },
    onSettled: refresh,
  });
  return { add, addMany, remove, restore };
}

/** The add box: type, press Enter (or Add). The text stays in the box until
 *  the server has it, and the state is always on screen — Saving / Added /
 *  Couldn't save — so nothing typed is ever silently lost. */
function AddReminderBox({ size }: { size: "card" | "slide" }) {
  const { add } = useReminderActions();
  const [text, setText] = useState("");
  const [forWhom, setForWhom] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const big = size === "slide";

  const save = () => {
    const t = text.trim();
    if (!t || add.isPending) return;
    setStatus("saving");
    add.mutate({ text: t, forWhom: forWhom.trim() || null }, {
      onSuccess: () => {
        setText(""); setForWhom(""); setStatus("saved"); setError(null);
        inputRef.current?.focus();
      },
      onError: (e: Error) => { setStatus("error"); setError(e.message); },
    });
  };

  return (
    <div>
      {/* The reminder gets its own full-width line (it's the main thing);
          "for whom" + Add sit underneath — side by side on the wide slide. */}
      <div className={cn("flex flex-col gap-2", big && "md:flex-row")}>
        <input
          ref={inputRef}
          value={text}
          onChange={e => { setText(e.target.value); if (status !== "saving") setStatus("idle"); }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
          placeholder="Add a reminder, e.g. Fire drill Thursday 11am"
          maxLength={500}
          aria-label="New reminder"
          className={cn(
            "w-full min-w-0 shrink-0 rounded-xl border border-border bg-background px-4 focus:outline-none focus:ring-2 focus:ring-primary/30",
            big ? "h-14 text-xl md:flex-1 md:w-auto" : "h-12 text-base",
          )}
        />
        <div className="flex gap-2">
        <input
          value={forWhom}
          onChange={e => setForWhom(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
          placeholder="For (optional)"
          maxLength={100}
          aria-label="Who the reminder is for (optional)"
          className={cn(
            "flex-1 min-w-0 rounded-xl border border-border bg-background px-4 focus:outline-none focus:ring-2 focus:ring-primary/30",
            big ? "h-14 text-xl md:w-56 md:flex-none" : "h-12 text-base",
          )}
        />
        <button
          onClick={save}
          disabled={!text.trim() || add.isPending}
          className={cn(
            "rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 px-5",
            big ? "h-14 text-xl" : "h-12 text-base",
          )}
        >
          {add.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />} Add
        </button>
        </div>
      </div>
      <p className={cn("mt-2 min-h-[1.25rem]", big ? "text-base" : "text-sm")} aria-live="polite">
        {status === "saving" && <span className="text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>}
        {status === "saved" && <span className="text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1.5"><Check className="w-4 h-4" /> Added — it'll show every morning until removed.</span>}
        {status === "error" && (
          <span className="text-destructive inline-flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Couldn't save{error ? ` (${error})` : ""} — your text is still here.
            <button onClick={save} className="underline font-medium">Try again</button>
          </span>
        )}
        {status === "idle" && <span className="text-muted-foreground">Press Enter to add. Shows on every meeting until you remove it.</span>}
      </p>
    </div>
  );
}

function ReminderRow({ r, onRemove, size }: { r: StandingReminder; onRemove: ((r: StandingReminder) => void) | null; size: "card" | "slide" }) {
  const big = size === "slide";
  return (
    <li className={cn("flex items-start gap-3 border-b border-border/50 last:border-0", big ? "px-6 py-4" : "py-3")}>
      <BellRing className={cn("shrink-0 text-amber-500", big ? "w-7 h-7 mt-1" : "w-5 h-5 mt-0.5")} />
      <div className="flex-1 min-w-0">
        <p className={cn("leading-snug break-words", big ? "text-2xl md:text-3xl" : "text-base font-medium")}>{r.text}</p>
        {r.forWhom && (
          <p className={cn("text-muted-foreground mt-0.5", big ? "text-lg" : "text-sm")}>For {r.forWhom}</p>
        )}
      </div>
      {onRemove && (
        <button
          onClick={() => onRemove(r)}
          aria-label={`Remove reminder: ${r.text}`}
          title="Remove (you can undo)"
          className={cn(
            "shrink-0 rounded-xl border border-border text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/40 inline-flex items-center justify-center gap-1.5 disabled:opacity-50",
            big ? "h-12 px-4 text-base font-medium" : "h-10 w-10",
          )}
        >
          <X className="w-5 h-5" />{big && "Remove"}
        </button>
      )}
    </li>
  );
}

/** Prep-page card: the quick-add box right at the top, then the list. */
export function StandingRemindersCard({ className }: { className?: string }) {
  const { data, isLoading, isError } = useStandingReminders();
  const canEdit = useCanEditReminders();
  const { remove } = useReminderActions();
  const onRemove = canEdit ? (r: StandingReminder) => remove.mutate(r) : null;
  const reminders = data?.reminders ?? [];
  return (
    <div className={cn("glass-panel rounded-2xl p-5 sm:p-6 border-2 border-primary/30", className)}>
      <div className="flex items-center gap-2 mb-1">
        <BellRing className="w-5 h-5 text-amber-500" />
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reminders — every day until removed</p>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        These show on their own slide in every morning meeting, straight after Safety, until someone removes them.
      </p>
      {canEdit && <AddReminderBox size="card" />}
      {isLoading ? (
        <div className="py-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : isError ? (
        <p className="text-sm text-destructive mt-2">Couldn't load the reminders — refresh to try again.</p>
      ) : reminders.length === 0 ? (
        <p className="text-sm text-muted-foreground italic mt-2">No standing reminders yet.</p>
      ) : (
        <ul className="mt-2">
          {reminders.map(r => <ReminderRow key={r.id} r={r} onRemove={onRemove} size="card" />)}
        </ul>
      )}
    </div>
  );
}

/** The slide the room sees. Big text; add/remove right there. */
export function StandingRemindersSlide({ title }: { title?: string }) {
  const { data, isLoading, isError } = useStandingReminders();
  const canEdit = useCanEditReminders();
  const { remove } = useReminderActions();
  const onRemove = canEdit ? (r: StandingReminder) => remove.mutate(r) : null;
  const reminders = data?.reminders ?? [];
  return (
    <div>
      <h2 className="text-5xl font-display font-bold mb-4 leading-tight">{title || "Reminders"}</h2>
      <p className="text-2xl text-muted-foreground mb-6 leading-snug">
        {reminders.length > 0 ? "Still on the list — read them out." : "Nothing on the list. Anything everyone needs reminding of?"}
      </p>
      {isLoading ? (
        <div className="py-6 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : isError ? (
        <p className="text-xl text-destructive mb-6">Couldn't load the reminders.</p>
      ) : reminders.length > 0 && (
        <ul className="glass-panel rounded-2xl overflow-hidden mb-6">
          {reminders.map(r => <ReminderRow key={r.id} r={r} onRemove={onRemove} size="slide" />)}
        </ul>
      )}
      {canEdit && (
        <div className="glass-panel rounded-2xl p-6">
          <p className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">Add a reminder</p>
          <AddReminderBox size="slide" />
        </div>
      )}
    </div>
  );
}
