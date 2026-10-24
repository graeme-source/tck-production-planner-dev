/**
 * The 8am to-do review (Graeme, 2026-10-24): "I need a daily, unmissable
 * task that pops up at 8 am every day to force me to review my to-do list.
 * I'm reliably just not going to it."
 *
 * From 8am (London) it takes over the screen once a day for anyone who has
 * it switched on. The first version showed a copy of the list that couldn't
 * be worked from ("showing me something that I can't actually action"), so
 * now the takeover is a compact card with ONE big button that opens the
 * REAL to-do list (TodoSheet — the same one Quick actions → My to-dos
 * opens). While the review is due, the list carries a slim banner with
 * "I've reviewed my list". Closing the list unfinished leaves it due: the
 * takeover comes back on the next page change or after five minutes.
 * "Not now" (and the X) snoozes it for 30 minutes on the server.
 * Server rule: api-server lib/todo-review.ts. View rule (takeover / banner /
 * nothing): lib/morning-review-view.ts. Objective E.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlarmClock, CheckCircle2, ClipboardList, Loader2, Sun, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { useReportPromptShowing, usePromptKeyShowing, DAILY_CHECKIN_PROMPT_KEY } from "@/lib/prompt-presence";
import { morningReviewView, quietAfterListClosed, reviewHeadline, type ReviewQuiet } from "@/lib/morning-review-view";
import { TodoSheet, isOverdue, useMyTodos, useTodoSheetOpen } from "@/components/todo-lists";

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

/** Finish ("done") or snooze the review for today. */
function useFinishTodoReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: "done" | "snooze") => send("/api/todos/review", "POST", action === "snooze" ? { action, minutes: 30 } : { action }),
    onSuccess: (_d, action) => {
      void qc.invalidateQueries({ queryKey: ["todo-review"] });
      if (action === "done") toast({ title: "List reviewed — have a good day" });
      else toast({ title: "Back in 30 minutes" });
    },
    onError: (e: Error) => toast({ title: "Didn't save", description: e.message, variant: "destructive" }),
  });
}

/** Is a Radix (shadcn) modal dialog open — e.g. the weekly DPT suggestion?
 *  It makes the rest of the page unclickable, our takeover included, so the
 *  takeover waits for it. Checked once a second while `enabled`. */
function useRadixDialogOpen(enabled: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled) { setOn(false); return; }
    const tick = () => setOn(!!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [enabled]);
  return on;
}

/** The takeover card. Mounted once, in QuickActionsDock. */
export function TodoMorningReview() {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  const review = useTodoReview();
  const checkinShowing = usePromptKeyShowing(DAILY_CHECKIN_PROMPT_KEY);
  const listOpen = useTodoSheetOpen();
  const [path] = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [quiet, setQuiet] = useState<ReviewQuiet | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const finish = useFinishTodoReview();
  const todos = useMyTodos();

  // Closing the list (from here or Quick actions) without finishing starts
  // the quiet spell; the review is still due, so the takeover returns.
  const wasOpen = useRef(listOpen);
  useEffect(() => {
    if (wasOpen.current && !listOpen) {
      const t = Date.now();
      setNow(t);
      setQuiet(quietAfterListClosed(t, path));
    }
    wasOpen.current = listOpen;
  }, [listOpen, path]);

  // Wake up when the quiet spell ends.
  useEffect(() => {
    if (!quiet) return;
    const ms = quiet.until - Date.now();
    if (ms <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), ms + 50);
    return () => clearTimeout(id);
  }, [quiet]);

  const due = !!me && !!review.data?.due;
  const otherDialogOpen = useRadixDialogOpen(due && !listOpen);
  const view = morningReviewView({ due, listOpen, checkinShowing, otherDialogOpen, quiet, now, path });
  const showing = view === "takeover";
  useReportPromptShowing("todo-review", showing);

  const open = todos.data?.open ?? [];
  const overdue = open.filter(isOverdue).length;

  return (
    <>
      <TodoSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      {showing && (
        <div className="fixed inset-0 z-[65] bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Morning to-do review">
          <div className="relative w-full sm:max-w-xl max-h-[92dvh] overflow-y-auto rounded-3xl bg-background border-2 border-amber-300 shadow-2xl p-6 md:p-8 space-y-6">
            <button
              onClick={() => finish.mutate("snooze")}
              aria-label="Not now — remind me in 30 minutes"
              title="Not now — back in 30 minutes"
              className="absolute top-3 right-3 w-14 h-14 rounded-2xl bg-secondary hover:bg-secondary/70 flex items-center justify-center"
            >
              <X className="w-7 h-7" />
            </button>
            <div className="flex items-start gap-4 pr-14">
              <Sun className="w-12 h-12 text-amber-500 flex-shrink-0" />
              <div className="min-w-0">
                <h2 className="font-display font-bold text-3xl leading-tight">Morning review</h2>
                <p className="text-xl font-semibold mt-1 break-words">
                  {todos.isLoading ? "Loading your list…" : reviewHeadline(open.length, overdue)}
                </p>
                <p className="text-base text-muted-foreground mt-1">
                  Go through your list — give each to-do a day, or get started and tick it off.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="w-full min-h-20 px-6 py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-2xl inline-flex items-center justify-center gap-3 shadow-lg shadow-primary/30"
            >
              <ClipboardList className="w-8 h-8 flex-shrink-0" /> Open my to-do list
            </button>
            <button
              type="button"
              onClick={() => finish.mutate("snooze")}
              disabled={finish.isPending}
              className="w-full h-14 px-5 rounded-2xl border-2 border-border font-bold text-lg inline-flex items-center justify-center gap-2 hover:bg-secondary disabled:opacity-50"
            >
              {finish.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <AlarmClock className="w-5 h-5" />} Not now — 30 min
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** The slim strip at the top of the real to-do list while the review is due. */
export function MorningReviewBanner() {
  const review = useTodoReview();
  const finish = useFinishTodoReview();
  if (!review.data?.due) return null;
  return (
    <div className="flex-shrink-0 border-b-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 md:px-6 py-2.5 flex flex-wrap items-center gap-3">
      <Sun className="w-6 h-6 text-amber-500 flex-shrink-0" />
      <p className="flex-1 min-w-[12rem] font-semibold text-amber-900 dark:text-amber-100 break-words">
        Morning review — go through your list, then tap “I've reviewed my list”
      </p>
      <button
        type="button"
        onClick={() => finish.mutate("done")}
        disabled={finish.isPending}
        className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-50"
      >
        {finish.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} I've reviewed my list
      </button>
    </div>
  );
}
