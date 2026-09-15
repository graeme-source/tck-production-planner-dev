/**
 * Station messages (Graeme, 2026-09-15): send a note to a station
 * ("Packing: the butcher collects the Mursley order at 2") and it shows as
 * a banner on that station's screen until someone there dismisses it.
 *
 * - StationMessagesBanner: incoming messages for one station, polled every
 *   30s so a note lands mid-shift without a refresh.
 * - SendStationMessageButton: opens the compose dialog (station picker +
 *   message). Mounted on station pages and the dashboard.
 * Dialog follows the standing modal rule: closable, max-h-[92dvh],
 * internal scroll.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, X, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { STATIONS } from "@/pages/station/shared/constants";
import { feedTimestamp } from "@/lib/feed-time";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface StationMessage { id: number; body: string; fromName: string | null; createdAt: string }

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

  const dismiss = async (id: number) => {
    await fetch(`${BASE}/api/station-messages/${id}/dismiss`, { method: "POST", credentials: "include" });
    void queryClient.invalidateQueries({ queryKey: ["station-messages", stationType] });
  };

  const messages = data?.messages ?? [];
  if (messages.length === 0) return null;

  return (
    <div className="space-y-2">
      {messages.map(m => (
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
  const [sending, setSending] = useState(false);
  const queryClient = useQueryClient();

  const send = async () => {
    if (!station || !body.trim()) return;
    setSending(true);
    try {
      const r = await fetch(`${BASE}/api/station-messages`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationType: station, body: body.trim() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to send");
      toast({ title: `Message sent to ${stationLabel(station)}`, description: "It shows on their screen until they dismiss it." });
      void queryClient.invalidateQueries({ queryKey: ["station-messages", station] });
      setBody("");
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

      {open && (
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
              <p className="text-xs text-muted-foreground">
                Shows as a banner on that station's screen until someone there taps "Got it". Disappears by itself after 48 hours.
              </p>
              <button
                onClick={send}
                disabled={sending || !station || !body.trim()}
                className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
