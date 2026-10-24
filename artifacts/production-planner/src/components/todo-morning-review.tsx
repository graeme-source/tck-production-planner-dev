/**
 * The 8am to-do review (Graeme, 2026-10-24): "I need a daily, unmissable
 * task that pops up at 8 am every day to force me to review my to-do list.
 * I'm reliably just not going to it."
 *
 * From 8am (London) it takes over the screen once a day for anyone who has
 * it switched on, until they press "I've reviewed my list". Every open
 * to-do is on one screen with big Today / Tomorrow / Next week / Done
 * buttons, and the smart add box is at the top for anything new. "Not now"
 * (and the X) snoozes it for 30 minutes — it always comes back the same
 * day. Server rule: lib/todo-review.ts.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, CalendarClock, CheckCircle2, Loader2, Sun, X } from "lucide-react";
import { addDays, describeRule, type RecurrenceRule } from "@workspace/recurrence";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { londonDay } from "@/lib/day-rollover";
import { useReportPromptShowing, usePromptKeyShowing, DAILY_CHECKIN_PROMPT_KEY } from "@/lib/prompt-presence";
import { SmartAddBox } from "@/components/smart-add/smart-add-box";
import { useMyTodos, type TodoTask } from "@/components/todo-lists";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function send(path: string, method: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method, credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
  return data;
}

export function useTodoReview() {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;
  return useQuery({
    queryKey: ["todo-review", meId],
    queryFn: async (): Promise<{ enabled: boolean; due: boolean; lastReviewedOn: string | null }> => send("/api/todos/review", "GET"),
    enabled: meId !== null,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useSetTodoReviewEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => send("/api/todos/review", "PUT", { enabled }),
    onSuccess: (_d, enabled) => {
      void qc.invalidateQueries({ queryKey: ["todo-review"] });
      toast({ title: enabled ? "Morning review on — it'll pop up at 8am every day" : "Morning review switched off" });
    },
    onError: (e: Error) => toast({ title: "Didn't save", description: e.message, variant: "destructive" }),
  });
}

const PRIORITY_BAR: Record<string, string> = { urgent: "bg-red-500", high: "bg-orange-500", normal: "bg-blue-500", low: "bg-muted-foreground/30" };

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

type Group = "overdue" | "today" | "undated" | "later";

function groupOf(t: TodoTask, today: string): Group {
  const day = (t.scheduled_for ?? t.due_date)?.slice(0, 10) ?? null;
  if (t.due_date && t.due_date.slice(0, 10) < today) return "overdue";
  if (!day) return "undated";
  if (day < today) return "overdue";
  if (day === today) return "today";
  return "later";
}

const GROUP_TITLE: Record<Group, string> = {
  overdue: "Overdue — decide now",
  today: "Today",
  undated: "No date yet — give them a day",
  later: "Coming up",
};

export function TodoMorningReview() {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  const review = useTodoReview();
  const checkinShowing = usePromptKeyShowing(DAILY_CHECKIN_PROMPT_KEY);
  const showing = !!me && !!review.data?.due && !checkinShowing;
  useReportPromptShowing("todo-review", showing);
  const todos = useMyTodos();
  const qc = useQueryClient();
  const today = londonDay(Date.now());

  const finish = useMutation({
    mutationFn: (action: "done" | "snooze") => send("/api/todos/review", "POST", action === "snooze" ? { action, minutes: 30 } : { action }),
    onSuccess: (_d, action) => {
      void qc.invalidateQueries({ queryKey: ["todo-review"] });
      if (action === "done") toast({ title: "List reviewed — have a good day" });
      else toast({ title: "Back in 30 minutes" });
    },
    onError: (e: Error) => toast({ title: "Didn't save", description: e.message, variant: "destructive" }),
  });

  // Giving an overdue to-do a new day moves a deadline that has already
  // passed along with it — otherwise it can never leave "Overdue".
  const move = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) => {
      const t = todos.data?.open.find(x => x.id === id);
      const pastDeadline = !!t?.due_date && t.due_date.slice(0, 10) < today;
      return send(`/api/todos/${id}`, "PATCH", { scheduledFor: date, ...(pastDeadline ? { dueDate: date } : {}) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
    onError: (e: Error) => toast({ title: "Didn't move it", description: e.message, variant: "destructive" }),
  });
  const done = useMutation({
    mutationFn: (id: number) => send(`/api/todos/${id}/complete`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
    onError: (e: Error) => toast({ title: "Couldn't mark it done", description: e.message, variant: "destructive" }),
  });

  const groups = useMemo(() => {
    const out: Record<Group, TodoTask[]> = { overdue: [], today: [], undated: [], later: [] };
    for (const t of todos.data?.open ?? []) out[groupOf(t, today)].push(t);
    return out;
  }, [todos.data, today]);

  if (!showing || !me) return null;
  const openCount = todos.data?.open.length ?? 0;
  const nextMonday = (() => { for (let i = 1; i <= 7; i++) { const d = addDays(today, i); if (new Date(`${d}T12:00:00Z`).getUTCDay() === 1) return d; } return addDays(today, 7); })();

  return (
    <div className="fixed inset-0 z-[65] bg-background flex flex-col" role="dialog" aria-modal="true" aria-label="Morning to-do review">
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-border flex-shrink-0">
        <Sun className="w-9 h-9 text-amber-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-bold text-2xl md:text-3xl leading-tight">Morning review</h2>
          <p className="text-base text-muted-foreground">
            {openCount === 0 ? "Your list is clear." : `${openCount} open to-do${openCount === 1 ? "" : "s"} — give each one a day, or tick it off.`}
          </p>
        </div>
        <button
          onClick={() => finish.mutate("snooze")}
          aria-label="Not now — remind me in 30 minutes"
          title="Not now — back in 30 minutes"
          className="w-14 h-14 rounded-2xl bg-secondary hover:bg-secondary/70 flex items-center justify-center flex-shrink-0"
        >
          <X className="w-7 h-7" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 pb-8 space-y-6">
          <SmartAddBox context={{ kind: "todo", assigneeId: me.id }} placeholder="Anything else on your mind? Add it here…" />

          {todos.isLoading && (
            <div className="flex items-center gap-3 text-lg text-muted-foreground py-8 justify-center"><Loader2 className="w-6 h-6 animate-spin" /> Loading your list…</div>
          )}

          {(["overdue", "today", "undated", "later"] as Group[]).map(g => groups[g].length > 0 && (
            <section key={g} className="space-y-2">
              <h3 className={cn("text-lg font-bold", g === "overdue" ? "text-red-600" : "text-foreground")}>
                {GROUP_TITLE[g]} <span className="text-muted-foreground font-semibold">({groups[g].length})</span>
              </h3>
              <div className="grid gap-2 xl:grid-cols-2">
                {groups[g].map(t => {
                  const day = (t.scheduled_for ?? null)?.slice(0, 10) ?? null;
                  const busy = (move.isPending && move.variables?.id === t.id) || (done.isPending && done.variables === t.id);
                  const rule = (t as TodoTask & { recurrence?: RecurrenceRule | null }).recurrence;
                  return (
                    <div key={t.id} className="rounded-2xl border-2 border-border bg-card flex overflow-hidden">
                      <div className={cn("w-2.5 flex-shrink-0", PRIORITY_BAR[t.priority] ?? "bg-blue-500")} />
                      <div className="flex-1 min-w-0 p-3 space-y-2">
                        <div>
                          <p className="text-lg font-bold leading-snug break-words">{t.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {day ? `For ${day === today ? "today" : shortDate(day)}` : "No day set"}
                            {t.due_date ? ` · due ${shortDate(t.due_date.slice(0, 10))}` : ""}
                            {rule ? ` · ${describeRule(rule)}` : ""}
                            {t.created_by_name && t.created_by !== me.id ? ` · from ${t.created_by_name}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {day !== today && <DayButton onClick={() => move.mutate({ id: t.id, date: today })} disabled={busy}>Today</DayButton>}
                          <DayButton onClick={() => move.mutate({ id: t.id, date: addDays(today, 1) })} disabled={busy}>Tomorrow</DayButton>
                          <DayButton onClick={() => move.mutate({ id: t.id, date: nextMonday })} disabled={busy}>Next week</DayButton>
                          <label className="h-11 px-3 rounded-xl border-2 border-border inline-flex items-center gap-1.5 font-semibold text-sm cursor-pointer hover:bg-secondary">
                            <CalendarClock className="w-4 h-4" /> Pick a day
                            <input type="date" min={today} className="sr-only" onChange={e => e.target.value && move.mutate({ id: t.id, date: e.target.value })} />
                          </label>
                          <button type="button" onClick={() => done.mutate(t.id)} disabled={busy}
                            className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Done
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-border px-4 md:px-6 py-3 flex flex-wrap items-center gap-3 bg-background">
        <button type="button" onClick={() => finish.mutate("snooze")} disabled={finish.isPending}
          className="h-14 px-5 rounded-2xl border-2 border-border font-bold text-lg inline-flex items-center gap-2 hover:bg-secondary">
          <AlarmClock className="w-5 h-5" /> Not now — 30 min
        </button>
        <div className="flex-1" />
        <button type="button" onClick={() => finish.mutate("done")} disabled={finish.isPending}
          className="h-16 px-6 rounded-2xl bg-primary text-primary-foreground font-bold text-xl inline-flex items-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-50">
          {finish.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle2 className="w-7 h-7" />} I've reviewed my list
        </button>
      </div>
    </div>
  );
}

function DayButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="h-11 px-4 rounded-xl border-2 border-border font-semibold text-sm hover:bg-secondary hover:border-primary/40 disabled:opacity-50">
      {children}
    </button>
  );
}
