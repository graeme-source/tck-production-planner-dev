/**
 * Marks an improvement seen once it has been read and scrolled past — the
 * rules are in lib/seen-on-scroll.ts. Fires at most once per card.
 */
import { useEffect, useRef } from "react";
import { isLookedAt, scrolledPastAfterReading } from "@/lib/seen-on-scroll";

export function useSeenOnScroll<T extends HTMLElement>(enabled: boolean, onSeen: () => void) {
  const ref = useRef<T | null>(null);
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === "undefined") return;
    let dwellMs = 0;
    let lookingSince: number | null = null;
    let fired = false;
    const thresholds = Array.from({ length: 21 }, (_, i) => i / 20);
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const now = performance.now();
        const viewportH = entry.rootBounds?.height ?? window.innerHeight;
        const looking = entry.isIntersecting
          && isLookedAt(entry.intersectionRect.height, entry.boundingClientRect.height, viewportH);
        if (looking && lookingSince == null) lookingSince = now;
        if (!looking && lookingSince != null) { dwellMs += now - lookingSince; lookingSince = null; }
        if (!fired && !entry.isIntersecting
          && scrolledPastAfterReading(dwellMs, entry.boundingClientRect.bottom, entry.rootBounds?.top ?? 0)) {
          fired = true;
          observer.disconnect();
          onSeenRef.current();
        }
      }
    }, { threshold: thresholds });
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return ref;
}
