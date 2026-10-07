/**
 * Station messages on a station's own screen (Graeme, 2026-09-15; part of
 * team messages since 2026-10-07).
 *
 * Messages are written and read in the Messages panel (the Messages button
 * in the top bar — components/messages). This is the part that makes sure a
 * station can't miss one: anything sent to THIS station in the last 48
 * hours that nobody here has confirmed yet shows as a banner, polled every
 * 30 s. Must-confirm ones lock the screen behind a full-screen notice until
 * someone taps the confirmation — deliberately NOT closable any other way
 * (2026-09-15). Shown on THAT station's screen only, never app-wide
 * (2026-09-29: the app-wide pop-up let the sender dismiss a wrapping
 * message from the Business page before wrapping ever saw it).
 *
 * Each banner links into the chat ("Reply") so the station can answer.
 * The overlay is portaled to document.body so no sticky page header can
 * sit on top of it.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, Loader2, ShieldAlert, Reply } from "lucide-react";
import { stationTarget } from "@workspace/messages";
import { feedTimestamp } from "@/lib/feed-time";
import { toast } from "@/hooks/use-toast";
import { routeStationMessages, messageShowsOnScreen } from "@/lib/station-message-rules";
import { useStationBanner, useAckMessage, usePeople, openMessages, type ApiMessage } from "@/components/messages/messages-api";
import { MessageBody } from "@/components/messages/message-body";

interface BannerMessage extends ApiMessage { requiresAck: boolean }

export function StationMessagesBanner({ stationType }: { stationType: string }) {
  const { data } = useStationBanner(stationType);
  const ack = useAckMessage([stationType]);
  const [acking, setAcking] = useState(false);
  const people = usePeople();

  const confirm = async (id: number, thenReplyKey?: string) => {
    setAcking(true);
    try {
      await ack.mutateAsync({ id, targets: [stationTarget(stationType)] });
      if (thenReplyKey) openMessages(thenReplyKey);
    } catch (err) {
      toast({ title: "Couldn't confirm", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setAcking(false);
    }
  };

  // Only messages addressed to THIS station — the server already filters
  // by station; this is the belt to its braces (lib/station-message-rules).
  const messages: BannerMessage[] = (data?.messages ?? []).filter(m =>
    m.audience.stations.some(s => messageShowsOnScreen(s, stationType)),
  );
  if (messages.length === 0) return null;

  const { blocking, blockedQueue, banners } = routeStationMessages(messages);
  const nameOf = (id: number) => people.data?.people.find(p => p.id === id)?.name;

  const blockingOverlay = blocking ? createPortal(
    <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4 md:p-8">
      <div className="bg-card border-4 border-red-500 rounded-2xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 bg-red-500/10 border-b border-red-500/40">
          <ShieldAlert className="w-6 h-6 text-red-600 flex-shrink-0" />
          <h2 className="font-display font-bold text-lg flex-1">Read this before carrying on</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <MessageBody body={blocking.body ?? ""} nameOf={nameOf} className="text-xl font-semibold" />
          <p className="text-sm text-muted-foreground">
            {blocking.senderName ?? "Someone"} · {feedTimestamp(blocking.createdAt)}
          </p>
          {blockedQueue.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {blockedQueue.length} more message{blockedQueue.length === 1 ? "" : "s"} to confirm after this one.
            </p>
          )}
        </div>
        <div className="p-5 pt-0 space-y-2">
          <button
            onClick={() => confirm(blocking.id)}
            disabled={acking}
            className="w-full h-14 rounded-xl bg-red-600 text-white text-base font-bold flex items-center justify-center gap-2 hover:bg-red-700 disabled:opacity-50"
          >
            {acking && <Loader2 className="w-5 h-5 animate-spin" />}
            Yes — I understand and will action this
          </button>
          <button
            onClick={() => confirm(blocking.id, blocking.conversationKey)}
            disabled={acking}
            className="w-full h-12 rounded-xl border-2 border-border text-base font-semibold flex items-center justify-center gap-2 hover:bg-secondary disabled:opacity-50"
          >
            <Reply className="w-5 h-5" /> Confirm and reply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="space-y-2">
      {blockingOverlay}
      {banners.map(m => (
        <div key={m.id} className="rounded-xl border-2 border-sky-300 dark:border-sky-800 bg-sky-50/80 dark:bg-sky-950/30 px-4 py-3 flex items-start gap-3">
          <MessageSquare className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <MessageBody body={m.body ?? ""} nameOf={nameOf} className="text-base font-medium text-sky-950 dark:text-sky-100" />
            <p className="text-xs text-sky-800/80 dark:text-sky-300/80 mt-1">
              {m.senderName ?? "Someone"} · {feedTimestamp(m.createdAt)}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
            <button
              onClick={() => openMessages(m.conversationKey)}
              className="text-xs font-bold px-3 py-1.5 rounded-lg border border-sky-300 dark:border-sky-800 bg-background hover:bg-sky-100 dark:hover:bg-sky-950/50 text-sky-800 dark:text-sky-200 flex items-center gap-1"
            >
              <Reply className="w-3.5 h-3.5" /> Reply
            </button>
            <button
              onClick={() => confirm(m.id)}
              className="text-xs font-bold px-3 py-1.5 rounded-lg border border-sky-300 dark:border-sky-800 bg-background hover:bg-sky-100 dark:hover:bg-sky-950/50 text-sky-800 dark:text-sky-200"
              title="Dismiss for this station — everyone here has seen it"
            >
              Got it
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
