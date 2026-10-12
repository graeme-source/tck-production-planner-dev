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
 * It goes ONCE per plan (Graeme, 2026-10-12). Once sent, the button is
 * replaced by a greyed "Sent to Shopify ✓" line — there is no send-again. The
 * server refuses a second send too (atomically, so two taps at once can't
 * both go), because there is more than one way to reach the endpoint and a
 * double send silently doubles the shelf. A correction is made in Shopify.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Send, AlertTriangle, CheckCircle2, ArrowRight, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import {
  submitFriedChickenStock, useFriedChickenStockSend, friedChickenStockSendKey,
  type SubmitStockResult, type StockAdjustment, type PriorSubmission,
} from "./api";
import { formatSentAt, sentToShopifyLabel } from "./format";

/** The greyed, untappable state that replaces the send button once the
 *  plan's stock has gone. */
function SentState({ record }: { record: PriorSubmission }) {
  if (record.status === "sending") {
    const when = formatSentAt(record.at);
    return (
      <div
        aria-disabled="true"
        className="w-full rounded-2xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-5 flex items-start gap-3"
      >
        <Loader2 className="w-7 h-7 text-amber-600 shrink-0 animate-spin" />
        <div>
          <p className="text-xl font-bold">Sending to Shopify{when ? ` — started ${when}` : ""}</p>
          <p className="text-base text-muted-foreground mt-1">
            It can't be sent twice. If this doesn't change to Sent in a minute, check
            Shopify's inventory history before doing anything else.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      aria-disabled="true"
      className="w-full rounded-2xl border-2 border-border bg-muted/60 p-5 flex items-start gap-3 text-muted-foreground cursor-not-allowed select-none"
    >
      <CheckCircle2 className="w-7 h-7 text-emerald-600/70 shrink-0" />
      <div>
        <p className="text-xl font-bold">{sentToShopifyLabel(record)}</p>
        <p className="text-base mt-1">
          This plan's stock only goes once. A correction is made in Shopify.
        </p>
      </div>
    </div>
  );
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

  const queryClient = useQueryClient();
  const sendState = useFriedChickenStockSend(planId);
  const [preview, setPreview] = useState<SubmitStockResult | null>(null);
  const [sent, setSent] = useState<SubmitStockResult | null>(null);

  const refreshSendState = () =>
    queryClient.invalidateQueries({ queryKey: friedChickenStockSendKey(planId) });

  const dryRun = useMutation({
    mutationFn: () => submitFriedChickenStock(planId, { confirm: false }),
    onSuccess: (r) => {
      setPreview(r); setSent(null);
      if (r.alreadySubmitted) refreshSendState();
    },
    onError: (err: Error) => toast({ title: "Couldn't check", description: err.message, variant: "destructive" }),
  });

  const send = useMutation({
    mutationFn: () => submitFriedChickenStock(planId, { confirm: true }),
    onSuccess: (r) => {
      setSent(r);
      setPreview(null);
      refreshSendState();
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
      // Includes the server's 409 when another tap or iPad got there first —
      // re-reading the send state swaps the button for "Sent to Shopify".
      setPreview(null);
      refreshSendState();
      toast({ title: "Not sent", description: err.message, variant: "destructive" });
    },
  });

  // Already gone — from this screen just now, another iPad, or the closing
  // check. The send button is not offered again.
  const record: PriorSubmission | null =
    sent?.sent ?? sendState.data?.sent ?? preview?.alreadySubmitted ?? null;

  if (record && !sent) return <SentState record={record} />;

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
    // Just sent from this screen: the greyed sent line, plus what happened to
    // each variant. If nothing landed the server gave the send back, so the
    // button returns once the send state is re-read.
    const failed = sent.adjustments.filter(a => a.result?.startsWith("failed"));
    return (
      <div className="space-y-3">
        {sent.sent && <SentState record={sent.sent} />}
        {failed.length > 0 && (
          <div className={cn("rounded-2xl border-2 p-5 flex items-start gap-3", "border-destructive/40 bg-destructive/5")}>
            <AlertTriangle className="w-7 h-7 text-destructive shrink-0" />
            <div>
              <p className="text-xl font-bold">
                {`${failed.length} variant${failed.length === 1 ? "" : "s"} didn't go through`}
              </p>
              <p className="text-base text-muted-foreground mt-1">
                {sent.sent
                  ? "Everything else landed. The ones that didn't go need adding in Shopify by hand — this plan can't be sent again."
                  : "Nothing landed, so nothing changed in Shopify. Fix the problem and try again."}
              </p>
            </div>
          </div>
        )}
        {!sent.sent && (
          <button
            type="button"
            onClick={() => setSent(null)}
            className="px-5 py-3 text-lg border-2 border-border rounded-xl hover:bg-secondary"
          >
            Back
          </button>
        )}
        <AdjustmentList rows={sent.adjustments} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {preview ? (
        <>
          <AdjustmentList rows={preview.adjustments} />
          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="px-5 py-3 text-lg border-2 border-border rounded-xl hover:bg-secondary"
            >
              Not yet
            </button>
            <button
              type="button"
              onClick={() => send.mutate()}
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
