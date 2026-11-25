import { useEffect } from "react";
import { peopleEntryNeedsPin } from "@/lib/sensitive-pin";

/**
 * People: the PIN on the way in; moving to another People screen asks again
 * only if there's been no touch, click or key for 20 seconds (Graeme, 24 Nov
 * 2026). Sitting on one page never locks it (25 Nov 2026: the first version
 * also locked every 20 idle seconds on the same page — "logging me out every
 * 20 seconds"; that timer is gone). Rules + tests: lib/sensitive-pin.ts.
 * Kept at module level, not in component state, because every move between
 * People pages rebuilds the page — the visit has to outlive the mount.
 */
let lastActiveAt: number | null = null;
let leftPeopleAt: number | null = null;
/** People pages open right now (the old one is still open while the next builds). */
let openPages = 0;

/** Call once as a People page opens: does this opening need the PIN? */
export function peopleEntryNeedsPinNow(): boolean {
  return peopleEntryNeedsPin({ now: Date.now(), leftPeopleAt, lastActiveAt, stillInside: openPages > 0 });
}

/**
 * While a People page is open and unlocked, note when it was last used —
 * any touch, click, key, scroll or mouse movement — so the next People
 * screen knows whether to ask for the PIN. It never locks by itself.
 */
export function usePeopleIdleLock(unlocked: boolean): void {
  // Leaving the page (to another People page or anywhere) notes when.
  useEffect(() => {
    openPages += 1;
    return () => { openPages -= 1; leftPeopleAt = Date.now(); };
  }, []);
  useEffect(() => {
    if (!unlocked) return;
    lastActiveAt = Date.now();
    let lastMove = 0;
    const active = () => { lastActiveAt = Date.now(); };
    const onMove = () => { const t = Date.now(); if (t - lastMove > 500) { lastMove = t; lastActiveAt = t; } };
    const opts = { capture: true, passive: true } as const;
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "input"] as const;
    for (const e of events) document.addEventListener(e, active, opts);
    document.addEventListener("pointermove", onMove, opts);
    return () => {
      for (const e of events) document.removeEventListener(e, active, opts);
      document.removeEventListener("pointermove", onMove, opts);
    };
  }, [unlocked]);
}
