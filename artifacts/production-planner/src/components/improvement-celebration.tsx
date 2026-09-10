/**
 * The improvement celebration — the WhatsApp-group moment, in the app
 * (Graeme, 2026-09-02), rebuilt as a NON-BLOCKING toast (Graeme,
 * 2026-09-10): the old full-screen modal trapped people mid-task — worst
 * case, mid-production-plan with no way back but killing the tab — and
 * dismissing one could instantly reveal the next identical-looking one,
 * which read as "it won't close".
 *
 * Now: a card slides up in the corner, celebrates for ten seconds, and
 * slides away on its own. Tap X to drop it sooner, tap "Show me" to jump
 * to the improvement itself. Nothing is ever blocked; the bell keeps the
 * notification for anyone who missed the ten seconds. Hovering pauses the
 * clock (someone reading shouldn't have it yanked away).
 *
 * Piggybacks the same 15-second notifications poll the flash banners use
 * (shared query key), so it costs no extra requests. One celebration at a
 * time, only for notifications younger than ten minutes, and each is
 * celebrated once per device (localStorage guard, best effort — an
 * auto-dismissing toast makes a re-show an annoyance, not a trap).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { PartyPopper, X } from "lucide-react";
import type { AppNotification } from "@/hooks/use-notifications";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const CELEBRATED_KEY = "tck-celebrated-notification-ids";
const MAX_AGE_MS = 10 * 60 * 1000;
const SHOW_MS = 10_000;

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

export function ImprovementCelebration() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [celebrated, setCelebrated] = useState<Set<number>>(() => loadCelebrated());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const dismiss = (id: number) => {
    setCelebrated(prev => {
      const next = new Set(prev);
      next.add(id);
      saveCelebrated(next);
      return next;
    });
  };

  // The ten-second clock. Re-armed per celebration; cleared on unmount.
  useEffect(() => {
    if (!current) return;
    const id = current.id;
    timerRef.current = setTimeout(() => dismiss(id), SHOW_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [current?.id]);

  const pauseClock = () => { if (timerRef.current) clearTimeout(timerRef.current); };
  const resumeClock = () => {
    if (!current) return;
    const id = current.id;
    pauseClock();
    timerRef.current = setTimeout(() => dismiss(id), SHOW_MS);
  };

  const showMe = () => {
    if (!current) return;
    const target = current.improvementId;
    // Reading it counts as read — the bell shouldn't keep pointing at it.
    fetch(`${BASE}/api/notifications/${current.id}/read`, { method: "PATCH", credentials: "include" })
      .then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }))
      .catch(() => { /* the bell will still show it — fine */ });
    dismiss(current.id);
    navigate(`/improvements?open=${target}`);
  };

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 80 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 80, transition: { duration: 0.4 } }}
          transition={{ type: "spring", damping: 22, stiffness: 260 }}
          // Bottom corner, above the dock, NO backdrop — the page behind
          // stays fully usable. pointer events only on the card itself.
          className="fixed bottom-24 right-4 left-4 sm:left-auto sm:w-[24rem] z-[120]"
          onMouseEnter={pauseClock}
          onMouseLeave={resumeClock}
        >
          <div className="bg-background border-2 border-primary/40 rounded-2xl shadow-2xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <PartyPopper className="w-6 h-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-lg leading-tight">Great news!</p>
                {/* The heading already says it — don't say it twice. */}
                <p className="text-sm leading-snug mt-0.5">{current.message.replace(/^Great news — /, "")}</p>
              </div>
              <button
                onClick={() => dismiss(current.id)}
                className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0 hover:bg-secondary/70"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={showMe}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-base font-bold active:scale-[0.99] transition-all"
            >
              Show me
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
