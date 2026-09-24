/**
 * "Your report has been fixed — please test it" (Graeme, 2026-09-24).
 *
 * When a fix that came from someone's issue report goes live, the issue
 * pipeline queues a notice for that reporter (resolve-issue in
 * routes/issue-pipeline-machine.ts). This takes over the screen on whatever
 * page they're on — the same app-wide pattern as the to-do and must-confirm
 * station-message interstitials, mounted beside them in QuickActionsDock.
 *
 * Two ways out, and both acknowledge (who, when and which is recorded so the
 * Fix queue shows the loop closed):
 *  - "Test it now" — only when the fix has an in-app page to test on; goes
 *    straight there.
 *  - "I'll test it later" — always there; the X does the same. Per the modal
 *    rule it can never trap anyone.
 *
 * Several at once (e.g. a backlog cleared in one morning) come as ONE pop-up
 * listing them all, with one button — never a string of separate pop-ups
 * (Graeme, 2026-09-24).
 *
 * Stacking: z-[60], deliberately UNDER the to-do takeover (z-[70]) and the
 * must-confirm station message (z-[300]) — those are work to do now; this is
 * good news that can wait its turn.
 */
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, MessageSquareText, PlayCircle, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { feedTimestamp } from "@/lib/feed-time";
import { batchedNoticeCopy, safeTestPath, type MyFixedNotice } from "@/lib/issue-pipeline";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function FixedNoticeInterstitial() {
  const { state } = useAuth();
  const loggedIn = state.status === "authenticated";
  const meId = loggedIn ? state.user.id : null;
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data } = useQuery<{ notices: MyFixedNotice[] }>({
    // Keyed by user so a shared iPad never shows one person's notice to the next.
    queryKey: ["issue-pipeline", "my-fixed-notices", meId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/issue-pipeline/my-fixed-notices`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: loggedIn,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const ack = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "test_now" | "later" }) => {
      const r = await fetch(`${BASE}/api/issue-pipeline/my-fixed-notices/${id}/ack`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      // 409 = already acknowledged (another tab/device) — the goal is met.
      if (!r.ok && r.status !== 409) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't save");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issue-pipeline", "my-fixed-notices"] }),
    onError: (e: Error) => toast({ title: "Couldn't save — try again", description: e.message, variant: "destructive" }),
  });

  // Clear a whole batch in one go: the chosen one (if they tapped "Test")
  // as test_now, the rest as later.
  const ackAll = useMutation({
    mutationFn: async ({ ids, testId }: { ids: number[]; testId?: number }) => {
      const results = await Promise.all(ids.map(id => fetch(`${BASE}/api/issue-pipeline/my-fixed-notices/${id}/ack`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: id === testId ? "test_now" : "later" }),
      })));
      if (results.some(r => !r.ok && r.status !== 409)) throw new Error("Couldn't save — some updates will show again");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["issue-pipeline", "my-fixed-notices"] }),
    onError: (e: Error) => toast({ title: "Couldn't save — try again", description: e.message, variant: "destructive" }),
  });

  const queue = data?.notices ?? [];
  const notice = queue[0] ?? null;
  if (!loggedIn || !notice) return null;
  if (queue.length > 1) return <BatchedNotices queue={queue} busy={ackAll.isPending} onDone={(testId, path) => {
    ackAll.mutate({ ids: queue.map(n => n.id), testId }, { onSuccess: () => { if (path) navigate(path); } });
  }} />;

  const testPath = safeTestPath(notice.testPath);
  // A reply from Graeme (e.g. "no fix needed — here's how to set it
  // yourself") rather than a fix: same pop-up, different words, one button.
  const isMessage = notice.kind === "message";
  const busy = ack.isPending;

  const later = () => ack.mutate({ id: notice.id, action: "later" });
  const testNow = async () => {
    if (!testPath) return;
    try {
      await ack.mutateAsync({ id: notice.id, action: "test_now" });
      navigate(testPath);
    } catch { /* onError toast covers it; the notice stays so nothing is lost */ }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/75 flex items-center justify-center p-3 md:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fixed-notice-title"
        className="bg-background border-4 border-primary rounded-3xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden"
      >
        <div className="flex items-start gap-3 px-5 md:px-7 pt-5 md:pt-7 pb-4 bg-primary/10 border-b border-primary/30">
          <CheckCircle2 className="w-12 h-12 md:w-14 md:h-14 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 id="fixed-notice-title" className="font-display font-bold text-2xl md:text-3xl leading-tight">
              {isMessage ? "A reply to your report" : "Your report has been fixed"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {isMessage ? "Thank you for reporting it." : "Thank you — this changed because you reported it."}
            </p>
          </div>
          <button
            onClick={later}
            disabled={busy}
            aria-label={isMessage ? "Close — got it" : "Close — I'll test it later"}
            title={isMessage ? "Close — got it" : "Close — I'll test it later"}
            className="w-11 h-11 rounded-xl border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 md:p-7 space-y-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">You reported</p>
            <blockquote className="text-lg md:text-xl leading-snug border-l-4 border-primary pl-4 whitespace-pre-wrap">
              “{notice.quote}”
            </blockquote>
            <p className="text-sm text-muted-foreground mt-1.5 pl-5">{feedTimestamp(notice.reportedAt)} · {notice.station}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">{isMessage ? "Reply" : "What's different"}</p>
            <p className="text-lg md:text-xl font-semibold whitespace-pre-wrap">{notice.whatChanged}</p>
          </div>
          {!isMessage && (
            <p className="text-base text-muted-foreground">
              Please test it and let us know if it's still not working — just report it again.
            </p>
          )}
        </div>

        <div className="p-5 md:p-7 pt-0 space-y-2">
          {testPath && (
            <button
              onClick={testNow}
              disabled={busy}
              className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlayCircle className="w-6 h-6" />}
              Test it now
            </button>
          )}
          <button
            onClick={later}
            disabled={busy}
            className={
              testPath
                ? "w-full h-14 rounded-2xl border-2 border-border text-base font-bold flex items-center justify-center gap-2 hover:bg-secondary/60 disabled:opacity-50"
                : "w-full h-16 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50"
            }
          >
            {busy && !testPath ? <Loader2 className="w-5 h-5 animate-spin" /> : isMessage ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
            {isMessage ? "Got it" : "I'll test it later"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Several updates at once: one pop-up, a card per report, one way out. */
function BatchedNotices({ queue, busy, onDone }: {
  queue: MyFixedNotice[];
  busy: boolean;
  /** testId/path set when they tapped one report's "Test it". */
  onDone: (testId?: number, path?: string) => void;
}) {
  const copy = batchedNoticeCopy(queue);
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/75 flex items-center justify-center p-3 md:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="batched-notice-title"
        className="bg-background border-4 border-primary rounded-3xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden"
      >
        <div className="flex items-start gap-3 px-5 md:px-7 pt-5 md:pt-7 pb-4 bg-primary/10 border-b border-primary/30">
          <CheckCircle2 className="w-12 h-12 md:w-14 md:h-14 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 id="batched-notice-title" className="font-display font-bold text-2xl md:text-3xl leading-tight">{copy.heading}</h2>
            <p className="text-sm text-muted-foreground mt-1">Thank you — these changed because you reported them.</p>
          </div>
          <button
            onClick={() => onDone()}
            disabled={busy}
            aria-label="Close — got it"
            className="w-11 h-11 rounded-xl border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
          {queue.map(n => {
            const isMessage = n.kind === "message";
            const path = safeTestPath(n.testPath);
            return (
              <div key={n.id} className="rounded-2xl border-2 border-border bg-card p-4 space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
                  {isMessage ? <MessageSquareText className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                  {isMessage ? "Reply" : "Fixed"}
                </p>
                <blockquote className="text-base leading-snug border-l-4 border-primary/60 pl-3 text-muted-foreground line-clamp-3">
                  “{n.quote}”
                </blockquote>
                <p className="text-lg font-semibold whitespace-pre-wrap">{n.whatChanged}</p>
                {path && !isMessage && (
                  <button
                    onClick={() => onDone(n.id, path)}
                    disabled={busy}
                    className="h-11 px-4 rounded-xl bg-primary/10 text-primary font-bold flex items-center gap-2 hover:bg-primary/20 disabled:opacity-50"
                  >
                    <PlayCircle className="w-5 h-5" /> Test it now
                  </button>
                )}
              </div>
            );
          })}
          <p className="text-sm text-muted-foreground px-1">If anything still isn't working, just report it again.</p>
        </div>

        <div className="p-4 md:p-6 pt-0">
          <button
            onClick={() => onDone()}
            disabled={busy}
            className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            {copy.button}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
