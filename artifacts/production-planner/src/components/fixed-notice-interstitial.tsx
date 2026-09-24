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
 * Stacking: z-[60], deliberately UNDER the to-do takeover (z-[70]) and the
 * must-confirm station message (z-[300]) — those are work to do now; this is
 * good news that can wait its turn.
 */
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, PlayCircle, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { feedTimestamp } from "@/lib/feed-time";
import { safeTestPath, type MyFixedNotice } from "@/lib/issue-pipeline";

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

  const queue = data?.notices ?? [];
  const notice = queue[0] ?? null;
  if (!loggedIn || !notice) return null;

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
              {queue.length > 1 ? ` · 1 of ${queue.length}` : ""}
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
