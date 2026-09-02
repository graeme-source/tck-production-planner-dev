/**
 * The improvement celebration — the WhatsApp-group moment, in the app
 * (Graeme, 2026-09-02: "Great news, someone's made an improvement... a
 * really positive moment"). When a teammate marks an improvement done, a
 * prominent popup appears for everyone else who has the app open: watch it
 * right there, or keep working and let the bell hold onto it.
 *
 * Piggybacks the same 15-second notifications poll the flash banners use
 * (shared query key), so it costs no extra requests. One celebration at a
 * time, only for notifications younger than ten minutes, and each is
 * celebrated once per device (localStorage guard, same pattern as the
 * flash banners). "I'll watch later" deliberately leaves the notification
 * UNREAD so the bell badge still points at it.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PartyPopper, Loader2, X } from "lucide-react";
import type { AppNotification } from "@/hooks/use-notifications";
import { ImprovementFeedMedia, type ImprovementMediaItem } from "@/components/improvement-feed-media";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const CELEBRATED_KEY = "tck-celebrated-notification-ids";
const MAX_AGE_MS = 10 * 60 * 1000;

function loadCelebrated(): Set<number> {
  try {
    const raw = localStorage.getItem(CELEBRATED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is number => typeof x === "number"));
  } catch { /* ignore */ }
  return new Set();
}

function saveCelebrated(set: Set<number>) {
  try {
    localStorage.setItem(CELEBRATED_KEY, JSON.stringify([...set].slice(-100)));
  } catch { /* storage full / disabled — worst case it re-shows, not a crash */ }
}

interface FeedImprovement {
  id: number;
  title: string;
  description: string;
  creditedToName: string | null;
  submittedByName: string | null;
  media?: ImprovementMediaItem[];
}

export function ImprovementCelebration() {
  const queryClient = useQueryClient();
  const [celebrated, setCelebrated] = useState<Set<number>>(() => loadCelebrated());
  const [watching, setWatching] = useState(false);

  // Same key as the flash-banner poll — this component adds no requests.
  const { data: list = [] } = useQuery<AppNotification[]>({
    queryKey: ["notifications", "list"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/notifications`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5_000,
  });

  const current = useMemo(() => {
    const now = Date.now();
    return list.find(n =>
      n.type === "improvement"
      && !n.read
      && n.improvementId != null
      && !celebrated.has(n.id)
      && now - new Date(n.createdAt).getTime() < MAX_AGE_MS,
    ) ?? null;
  }, [list, celebrated]);

  // The improvement itself (title, credit, media incl. the stitched clip) is
  // fetched only once someone taps "Show me now".
  const { data: improvement, isLoading: improvementLoading } = useQuery<FeedImprovement | null>({
    queryKey: ["celebration-improvement", current?.improvementId],
    enabled: watching && current?.improvementId != null,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/improvements`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the improvement");
      const all: FeedImprovement[] = await res.json();
      return all.find(i => i.id === current!.improvementId) ?? null;
    },
  });

  if (!current) return null;

  const dismiss = (markAsRead: boolean) => {
    setCelebrated(prev => {
      const next = new Set(prev);
      next.add(current.id);
      saveCelebrated(next);
      return next;
    });
    setWatching(false);
    if (markAsRead) {
      fetch(`${BASE}/api/notifications/${current.id}/read`, { method: "PATCH", credentials: "include" })
        .then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }))
        .catch(() => { /* the bell will still show it — fine */ });
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-background w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-6 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <PartyPopper className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-2xl font-bold leading-tight">Great news!</h2>
          </div>
          <button
            onClick={() => dismiss(false)}
            className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* The heading already says "Great news!" — don't say it twice. */}
        <p className="text-lg leading-snug">{current.message.replace(/^Great news — /, "")}</p>

        {watching ? (
          improvementLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>
          ) : improvement ? (
            <>
              <ImprovementFeedMedia media={improvement.media} />
              {improvement.description && improvement.description !== improvement.title && (
                <p className="text-base text-muted-foreground">{improvement.description}</p>
              )}
              <button
                onClick={() => dismiss(true)}
                className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold active:scale-[0.99] transition-all"
              >
                Brilliant 🎉
              </button>
            </>
          ) : (
            <p className="text-base text-muted-foreground">Couldn't load it here — it's waiting on the Improvements page.</p>
          )
        ) : (
          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={() => setWatching(true)}
              className="h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold active:scale-[0.99] transition-all"
            >
              Show me now
            </button>
            <button
              onClick={() => dismiss(false)}
              className="h-12 rounded-2xl border-2 border-border text-base font-semibold text-muted-foreground hover:text-foreground"
            >
              I'll watch it later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
