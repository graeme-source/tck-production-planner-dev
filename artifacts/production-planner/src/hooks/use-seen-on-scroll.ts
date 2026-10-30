/**
 * Marks an improvement seen once it has sat in view, read to its end, for
 * about three seconds — or been skimmed and scrolled past. The rules are in
 * lib/seen-on-scroll.ts. Fires at most once per card.
 *
 * Samples the card's position on every scroll of the box it lives in (one
 * per animation frame) and four times a second while it sits still, so the
 * clocks run while you read and "in view" / "past" are judged from where the card
 * actually is — not from catching one exact edge-crossing event, which the
 * first version depended on and often missed (Graeme, 16 and 24 Oct).
 */
import { useEffect, useRef } from "react";
import { newSeenTracker, stepSeen } from "@/lib/seen-on-scroll";
import { appScrollContainer } from "@/lib/scroll";

const TICK_MS = 250;

export function useSeenOnScroll<T extends HTMLElement>(enabled: boolean, onSeen: () => void) {
  const ref = useRef<T | null>(null);
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    // Sidebar pages scroll #app-main-scroll (it starts below the top bar);
    // full-screen pages scroll the window.
    const container = appScrollContainer();
    const box = container && container !== el && container.contains(el) ? container : null;

    let tracker = newSeenTracker();
    let fired = false;
    let frame = 0;

    const sample = () => {
      frame = 0;
      if (fired || !el.isConnected) return;
      const card = el.getBoundingClientRect();
      let rootTop = 0;
      let rootBottom = window.innerHeight;
      let atEnd: boolean;
      if (box) {
        rootTop = box.getBoundingClientRect().top;
        rootBottom = rootTop + box.clientHeight;
        atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
      } else {
        const doc = document.scrollingElement ?? document.documentElement;
        atEnd = window.scrollY + window.innerHeight >= doc.scrollHeight - 2;
      }
      const step = stepSeen(tracker, {
        now: performance.now(),
        cardTop: card.top,
        cardBottom: card.bottom,
        rootTop,
        rootBottom,
        atEnd,
        hidden: document.visibilityState === "hidden",
      });
      tracker = step.tracker;
      if (step.seen) {
        fired = true;
        stop();
        onSeenRef.current();
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(sample); };
    const scroller: HTMLElement | Window = box ?? window;
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    document.addEventListener("visibilitychange", sample);
    const timer = window.setInterval(sample, TICK_MS);
    sample();

    function stop() {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("visibilitychange", sample);
      window.clearInterval(timer);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
    return stop;
  }, [enabled]);

  return ref;
}
