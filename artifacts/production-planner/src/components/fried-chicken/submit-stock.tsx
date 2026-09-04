/**
 * Sending the day's counted bags to Shopify.
 *
 * This is the one thing on the fried chicken station that reaches outside the
 * building, and it ADDS to the shelf — so it is deliberately slow. Nothing
 * goes anywhere until you have seen exactly what will be sent, variant by
 * variant, and said yes to that.
 *
 * What gets sent is what was COUNTED, never the target. The plan is a guide;
 * the sauce runs out where it runs out (Graeme, 2026-09-03).
 *
 * A plan whose stock has already gone is refused by the server, not just
 * greyed out here — there is more than one way to reach the endpoint, and a
 * double send silently doubles the shelf.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Loader2, Send, AlertTriangle, CheckCircle2, ArrowRight, Lock, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { submitFriedChickenStock, type SubmitStockResult, type StockAdjustment } from "./api";

function whenLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** What will happen to one variant, in the words of someone standing at the
 *  fryer rather than the words of the API. */
function outcomeLabel(row: StockAdjustment): { text: string; tone: string } {
  if (row.result === "added") {
    return { text: `sent — shelf now ${row.newQuantity ?? "?"}`, tone: "text-emerald-600 dark:text-emerald-400" };
  }
  if (row.result?.startsWith("failed")) {
    return { text: row.result, tone: "text-destructive" };
  }
  if (row.result) {
    return { text: row.result, tone: "text-amber-600 dark:text-amber-400" };
  }
  if (!row.variantId) {
    return { text: "no Shopify product linked — will be skipped", tone: "text-amber-600 dark:text-amber-400" };
  }
  if (row.made <= 0) {
    return { text: "nothing counted — will be skipped", tone: "text-muted-foreground" };
  }
  return { text: `will add ${row.made} to the shelf`, tone: "text-foreground" };
}

function AdjustmentList({ rows }: { rows: StockAdjustment[] }) {
  return (
    <div className="rounded-2xl border-2 border-border overflow-hidden divide-y divide-border/60">
      {rows.map(row => {
        const outcome = outcomeLabel(row);
        return (
          <div key={row.recipeName} className="px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-lg font-semibold flex-1 min-w-0">{row.recipeName}</span>
            <span className="text-sm text-muted-foreground tabular-nums">
              counted {row.made} of {row.target}
            </span>
            <span className={cn("text-sm font-medium w-full sm:w-auto", outcome.tone)}>{outcome.text}</span>
          </div>
        );
      })}
    </div>
  );
}

export function FriedChickenSubmitStock({ planId, countedBags }: {
  planId: number;
  /** What the count sheet currently shows, so the panel can say plainly that
   *  a zero count sends nothing. */
  countedBags: number;
}) {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : undefined;
  const canSubmit = role === "admin" || role === "manager";

  const [preview, setPreview] = useState<SubmitStockResult | null>(null);
  const [sent, setSent] = useState<SubmitStockResult | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const dryRun = useMutation({
    mutationFn: () => submitFriedChickenStock(planId, { confirm: false }),
    onSuccess: (r) => { setPreview(r); setSent(null); setBlocked(null); },
    onError: (err: Error) => toast({ title: "Couldn't check", description: err.message, variant: "destructive" }),
  });

  const send = useMutation({
    mutationFn: (force: boolean) => submitFriedChickenStock(planId, { confirm: true, force }),
    onSuccess: (r) => {
      setSent(r);
      setPreview(null);
      const failed = r.adjustments.filter(a => a.result?.startsWith("failed")).length;
      toast({
        title: failed > 0 ? "Sent, with problems" : `${r.bagsSent ?? 0} bags sent to Shopify`,
        description: failed > 0
          ? `${failed} variant${failed === 1 ? "" : "s"} didn't go through — see the list.`
          : "The shelf now includes today's chicken.",
        variant: failed > 0 ? "destructive" : undefined,
      });
    },
    onError: (err: Error) => {
      // The server's own double-send guard. Surfaced as a state rather than a
      // toast, because the next step is a decision, not an acknowledgement.
      if (/already/i.test(err.message)) setBlocked(err.message);
      else toast({ title: "Not sent", description: err.message, variant: "destructive" });
    },
  });

  if (!canSubmit) {
    return (
      <div className="rounded-2xl border-2 border-border bg-card p-4 flex items-start gap-3">
        <Lock className="w-6 h-6 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-base">
          Counting is done — a manager sends the {countedBags} counted bags to Shopify from this screen.
        </p>
      </div>
    );
  }

  if (sent) {
    const failed = sent.adjustments.filter(a => a.result?.startsWith("failed"));
    return (
      <div className="space-y-3">
        <div className={cn(
          "rounded-2xl border-2 p-5 flex items-start gap-3",
          failed.length > 0
            ? "border-destructive/40 bg-destructive/5"
            : "border-emerald-400 bg-emerald-500/10",
        )}>
          {failed.length > 0
            ? <AlertTriangle className="w-7 h-7 text-destructive shrink-0" />
            : <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" />}
          <div>
            <p className="text-xl font-bold">
              {failed.length > 0
                ? `${failed.length} variant${failed.length === 1 ? "" : "s"} didn't go through`
                : `${sent.bagsSent ?? 0} bags sent to Shopify`}
            </p>
            <p className="text-base text-muted-foreground mt-1">
              {failed.length > 0
                ? "Everything else landed. Fix the problem and send again — the ones that already went are recorded."
                : "Worth checking against Shopify's own inventory history the first time."}
            </p>
          </div>
        </div>
        <AdjustmentList rows={sent.adjustments} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {blocked && (
        <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-lg font-bold">Already sent</p>
              <p className="text-base mt-1">
                This plan's counted bags have gone to Shopify once. Sending again adds them
                a second time and doubles the shelf.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => send.mutate(true)}
            disabled={send.isPending}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-destructive text-destructive font-semibold hover:bg-destructive/10 disabled:opacity-50"
          >
            {send.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <RotateCcw className="w-5 h-5" />}
            Send again anyway
          </button>
        </div>
      )}

      {preview ? (
        <>
          {preview.alreadySubmitted && (
            <div className="rounded-2xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-4 flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-base">
                Already sent {whenLabel(preview.alreadySubmitted.at)} — {preview.alreadySubmitted.bags} bags.
                Sending again would add them on top.
              </p>
            </div>
          )}
          <AdjustmentList rows={preview.adjustments} />
          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => { setPreview(null); setBlocked(null); }}
              className="px-5 py-3 text-lg border-2 border-border rounded-xl hover:bg-secondary"
            >
              Not yet
            </button>
            <button
              type="button"
              onClick={() => send.mutate(false)}
              disabled={send.isPending}
              className="flex-1 min-w-[14rem] px-5 py-3 text-lg bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {send.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              Send these to Shopify
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => dryRun.mutate()}
          disabled={dryRun.isPending}
          className="w-full rounded-2xl border-2 border-border bg-card p-5 text-left hover:border-primary hover:bg-secondary/40 transition-colors disabled:opacity-60"
        >
          <div className="flex items-center gap-3">
            {dryRun.isPending
              ? <Loader2 className="w-7 h-7 animate-spin text-muted-foreground shrink-0" />
              : <Send className="w-7 h-7 text-primary shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-xl font-bold">Send today's count to Shopify</p>
              <p className="text-base text-muted-foreground mt-0.5">
                {countedBags > 0
                  ? `Shows you the ${countedBags} counted bags first — nothing moves until you say so.`
                  : "Nothing counted yet, so nothing would be sent."}
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" />
          </div>
        </button>
      )}
    </div>
  );
}
