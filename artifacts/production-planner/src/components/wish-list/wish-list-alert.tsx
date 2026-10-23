/**
 * "Something's been added to the Wish List" — the must-dismiss pop-up for
 * the founder and admins (Graeme, 23 Oct 2026: "I actually need a pop-up so
 * I can't miss it… that I have to dismiss before I can continue").
 *
 * Shows on any page whenever items have been added since you last tapped
 * Got it (checked every minute and when the app comes back into focus).
 * Several at once come as ONE pop-up listing them all. Who sees it is the
 * server's call (lib/wish-list.ts canManageWishList) — everyone else just
 * gets an empty list.
 *
 * Covers the screen until dismissed, but per the modal rule it can never
 * trap anyone: Got it, Open Wish List and the X all acknowledge everything
 * shown. Card capped at 92dvh with its own scroll.
 *
 * Stacking: z-[60], the same tier as the "your report was fixed" notice and
 * under the to-do takeover (z-[70]); waits for the daily improvement
 * check-in like the other pop-ups.
 */
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { ExternalLink, Gift, Loader2, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { feedTimestamp } from "@/lib/feed-time";
import { DAILY_CHECKIN_PROMPT_KEY, usePromptKeyShowing, useReportPromptShowing } from "@/lib/prompt-presence";
import { useAckWishListAlerts, useWishListAlerts } from "@/hooks/use-wish-list";
import { WISH_LIST_NAME, WISH_LIST_PATH, formatPence, vatWord } from "@/lib/wish-list";

export function WishListAlert() {
  const { data } = useWishListAlerts();
  const ack = useAckWishListAlerts();
  const [, navigate] = useLocation();
  const checkinShowing = usePromptKeyShowing(DAILY_CHECKIN_PROMPT_KEY);
  const items = data?.items ?? [];
  const showing = items.length > 0 && !checkinShowing;
  useReportPromptShowing("wish-list-alert", showing);
  if (!showing) return null;

  const upToId = Math.max(...items.map(i => i.id));
  const done = (then?: () => void) => ack.mutate(upToId, {
    onSuccess: () => then?.(),
    onError: (e: Error) => toast({ title: "Couldn't save — try again", description: e.message, variant: "destructive" }),
  });
  const busy = ack.isPending;
  const one = items.length === 1;

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/75 flex items-center justify-center p-3 md:p-8">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="wish-alert-title"
        className="bg-background border-4 border-pink-500 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
      >
        <div className="flex items-start gap-3 px-5 md:px-7 pt-5 md:pt-7 pb-4 bg-pink-500/10 border-b border-pink-500/30">
          <Gift className="w-12 h-12 md:w-14 md:h-14 text-pink-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 id="wish-alert-title" className="font-display font-bold text-2xl md:text-3xl leading-tight">
              {one ? `Something's been added to the ${WISH_LIST_NAME}` : `${items.length} things added to the ${WISH_LIST_NAME}`}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Someone on the team has asked for {one ? "this" : "these"}.</p>
          </div>
          <button
            onClick={() => done()}
            disabled={busy}
            aria-label="Close — got it"
            title="Close — got it"
            className="w-11 h-11 rounded-xl border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
          {items.map(item => {
            const price = formatPence(item.pricePence, item.currency);
            return (
              <li key={item.id} className="flex gap-4 items-center rounded-2xl border-2 border-border p-3 md:p-4">
                {item.imageUrl && (
                  <img src={item.imageUrl} alt="" className="w-20 h-20 rounded-xl object-contain bg-white border border-border flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-lg md:text-xl font-bold break-words underline-offset-4 hover:underline">
                      {item.title} <ExternalLink className="inline w-4 h-4 align-baseline" />
                    </a>
                  ) : (
                    <p className="text-lg md:text-xl font-bold break-words">{item.title}</p>
                  )}
                  <p className="text-base">
                    {price ? <span className="font-bold tabular-nums">{price}</span> : <span className="text-muted-foreground">No price</span>}
                    {price && vatWord(item.priceIncludesVat) && <span className="text-muted-foreground"> {vatWord(item.priceIncludesVat)}</span>}
                    {item.quantity > 1 && <span className="text-muted-foreground"> × {item.quantity}</span>}
                    {item.storeName && <span className="text-muted-foreground"> · {item.storeName}</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {item.createdByName ?? "Someone"} · {feedTimestamp(item.createdAt)}
                  </p>
                  {item.notes && <p className="text-sm mt-1 whitespace-pre-wrap break-words">“{item.notes}”</p>}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="p-4 md:p-6 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-border">
          <button
            onClick={() => done()}
            disabled={busy}
            className="h-16 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy && <Loader2 className="w-5 h-5 animate-spin" />} Got it
          </button>
          <button
            onClick={() => done(() => navigate(WISH_LIST_PATH))}
            disabled={busy}
            className="h-16 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/60 disabled:opacity-50"
          >
            Open {WISH_LIST_NAME}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
