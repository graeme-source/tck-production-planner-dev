/**
 * Marks an improvement seen once it has been read and scrolled past — the
 * rules are in lib/seen-on-scroll.ts. Fires at most once per card.
 */
import { useEffect, useRef } from "react";
import { isLookedAt, scrolledPastAfterReading } from "@/lib/seen-on-scroll";
import { appScrollContainer } from "@/lib/scroll";

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
    // Watch against the box the card really scrolls in. Sidebar pages scroll
    // #app-main-scroll, which starts below the top bar; with the window as
    // the root, "off the top" was measured against the wrong edge and a card
    // hidden under the top bar never counted (Graeme, 2026-10-16). Full-
    // screen pages scroll the window, so fall back to that.
    const container = appScrollContainer();
    const root = container && container !== el && container.contains(el) ? container : null;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const now = performance.now();
        const viewportH = entry.rootBounds?.height ?? root?.clientHeight ?? window.innerHeight;
        const rootTop = entry.rootBounds?.top ?? root?.getBoundingClientRect().top ?? 0;
        const looking = entry.isIntersecting
          && isLookedAt(entry.intersectionRect.height, entry.boundingClientRect.height, viewportH);
        if (looking && lookingSince == null) lookingSince = now;
        if (!looking && lookingSince != null) { dwellMs += now - lookingSince; lookingSince = null; }
        if (!fired && !entry.isIntersecting
          && scrolledPastAfterReading(dwellMs, entry.boundingClientRect.bottom, rootTop)) {
          fired = true;
          observer.disconnect();
          onSeenRef.current();
        }
      }
    }, { root, threshold: thresholds });
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return ref;
}
