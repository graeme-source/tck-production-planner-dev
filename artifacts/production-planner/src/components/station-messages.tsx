/**
 * Station messages (Graeme, 2026-09-15): send a note to a station
 * ("Packing: the butcher collects the Mursley order at 2") and it shows as
 * a banner on that station's screen until someone there dismisses it.
 *
 * - StationMessagesBanner: incoming messages for one station, polled every
 *   30s so a note lands mid-shift without a refresh. Messages sent with
 *   "must be confirmed" render as a full-screen lock instead of a banner:
 *   the station can't be used until someone taps the confirmation. That
 *   overlay is deliberately NOT closable any other way (Graeme, 2026-09-15).
 * - SendStationMessageButton: opens the compose dialog (station picker +
 *   message + must-confirm toggle). Mounted on station pages and the
 *   dashboard.
 * Compose dialog follows the standing modal rule: closable, max-h-[92dvh],
 * internal scroll. Both overlays render through a portal to document.body:
 * the send button lives inside sticky page headers whose stacking context
 * (e.g. StationLayout's sticky z-20 bar) would otherwise trap the modal
 * underneath the surrounding chrome — that's the "modal hidden behind the
 * header bar" bug from 2026-09-15.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, X, Send, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { STATIONS } from "@/pages/station/shared/constants";
import { feedTimestamp } from "@/lib/feed-time";
import { routeStationMessages } from "@/lib/station-message-rules";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface StationMessage { id: number; body: string; fromName: string | null; createdAt: string; requiresAck?: boolean }

const stationLabel = (key: string) =>
  STATIONS.find(s => s.key === key)?.label ?? key;

export function StationMessagesBanner({ stationType }: { stationType: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery<{ messages: StationMessage[] }>({
    queryKey: ["station-messages", stationType],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/station-messages?station=${encodeURIComponent(stationType)}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const [acking, setAcking] = useState(false);

  const dismiss = async (id: number) => {
    await fetch(`${BASE}/api/station-messages/${id}/dismiss`, { method: "POST", credentials: "include" });
    void queryClient.invalidateQueries({ queryKey: ["station-messages", stationType] });
  };

  const messages = data?.messages ?? [];
  if (messages.length === 0) return null;

  const { blocking, blockedQueue, banners } = routeStationMessages(messages);

  // Full-screen lock for a must-confirm message: nothing on the station is
  // usable until someone explicitly confirms it. No X, no backdrop close —
  // the confirmation IS the only way out, by design. Portaled to the body
  // so no page header can sit on top of it.
  const blockingOverlay = blocking ? createPortal(
    <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4 md:p-8">
      <div className="bg-card border-4 border-red-500 rounded-2xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 bg-red-500/10 border-b border-red-500/40">
          <ShieldAlert className="w-6 h-6 text-red-600 flex-shrink-0" />
          <h2 className="font-display font-bold text-lg flex-1">Read this before carrying on</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <p className="text-xl font-semibold whitespace-pre-wrap">{blocking.body}</p>
          <p className="text-sm text-muted-foreground">
            {blocking.fromName ?? "Someone"} · {feedTimestamp(blocking.createdAt)}
          </p>
          {blockedQueue.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {blockedQueue.length} more message{blockedQueue.length === 1 ? "" : "s"} to confirm after this one.
            </p>
          )}
        </div>
        <div className="p-5 pt-0">
          <button
            onClick={async () => {
              setAcking(true);
              try { await dismiss(blocking.id); } finally { setAcking(false); }
            }}
            disabled={acking}
            className="w-full h-14 rounded-xl bg-red-600 text-white text-base font-bold flex items-center justify-center gap-2 hover:bg-red-700 disabled:opacity-50"
          >
            {acking && <Loader2 className="w-5 h-5 animate-spin" />}
            Yes — I understand and will action this
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
            <p className="text-base font-medium text-sky-950 dark:text-sky-100 whitespace-pre-wrap">{m.body}</p>
            <p className="text-xs text-sky-800/80 dark:text-sky-300/80 mt-1">
              {m.fromName ?? "Someone"} · {feedTimestamp(m.createdAt)}
            </p>
          </div>
          <button
            onClick={() => dismiss(m.id)}
            className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg border border-sky-300 dark:border-sky-800 bg-background hover:bg-sky-100 dark:hover:bg-sky-950/50 text-sky-800 dark:text-sky-200"
            title="Dismiss for this station — everyone here has seen it"
          >
            Got it
          </button>
        </div>
      ))}
    </div>
  );
}

export function SendStationMessageButton({ defaultStation, className }: { defaultStation?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [station, setStation] = useState(defaultStation ?? "");
  const [body, setBody] = useState("");
  const [requiresAck, setRequiresAck] = useState(false);
  const [sending, setSending] = useState(false);
  const queryClient = useQueryClient();

  const send = async () => {
    if (!station || !body.trim()) return;
    setSending(true);
    try {
      const r = await fetch(`${BASE}/api/station-messages`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationType: station, body: body.trim(), requiresAck }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to send");
      toast({
        title: `Message sent to ${stationLabel(station)}`,
        description: requiresAck
          ? "Their screen is locked behind it until someone confirms they'll action it."
          : "It shows on their screen until they dismiss it.",
      });
      void queryClient.invalidateQueries({ queryKey: ["station-messages", station] });
      setBody("");
      setRequiresAck(false);
      setOpen(false);
    } catch (err) {
      toast({ title: "Couldn't send", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn("flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors border border-border rounded-lg px-3 py-1.5", className)}
        title="Send a message to a station"
      >
        <MessageSquare className="w-4 h-4" />
        <span className="hidden sm:inline">Message a station</span>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[130] bg-black/70 flex items-center justify-center p-3 md:p-8" onClick={() => setOpen(false)}>
          <div
            className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
              <MessageSquare className="w-5 h-5 text-sky-600 flex-shrink-0" />
              <h2 className="font-display font-bold text-lg flex-1">Message a station</h2>
              <button onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="text-sm font-semibold block mb-1">To</label>
                <select
                  value={station}
                  onChange={e => setStation(e.target.value)}
                  className="w-full px-3 py-2.5 bg-background border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">Choose a station…</option>
                  {STATIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1">Message</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="e.g. The Mursley wholesale order gets collected at 2 today — have it boxed by 1:30."
                  className="w-full min-h-[110px] px-3 py-2.5 bg-background border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
                  maxLength={1000}
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={() => setRequiresAck(v => !v)}
                className={cn(
                  "w-full text-left rounded-xl border-2 px-4 py-3 flex items-start gap-3 transition-colors",
                  requiresAck
                    ? "border-red-500 bg-red-500/10"
                    : "border-border bg-background hover:bg-secondary/50",
                )}
              >
                <ShieldAlert className={cn("w-5 h-5 flex-shrink-0 mt-0.5", requiresAck ? "text-red-600" : "text-muted-foreground")} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Must be confirmed{requiresAck ? " — ON" : ""}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Locks that station's screen behind this message. Nobody there can carry on until someone taps
                    "Yes — I understand and will action this".
                  </span>
                </span>
              </button>
              <p className="text-xs text-muted-foreground">
                {requiresAck
                  ? "Their screen stays locked until confirmed. Disappears by itself after 48 hours if the station isn't opened."
                  : "Shows as a banner on that station's screen until someone there taps \"Got it\". Disappears by itself after 48 hours."}
              </p>
              <button
                onClick={send}
                disabled={sending || !station || !body.trim()}
                className={cn(
                  "w-full h-12 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50",
                  requiresAck ? "bg-red-600 text-white hover:bg-red-700" : "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {requiresAck ? "Send — must be confirmed" : "Send"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
