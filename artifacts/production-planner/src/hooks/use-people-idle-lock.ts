import { useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { peopleEntryNeedsPin, peopleIdleExpired } from "@/lib/sensitive-pin";

/**
 * People: the PIN on the way in, then a 20-second idle lock (Graeme, 24 Nov
 * 2026). Rules + tests: lib/sensitive-pin.ts. Kept at module level, not in
 * component state, because every move between People pages rebuilds the
 * page — the visit has to outlive the mount.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
let lastActiveAt: number | null = null;
let leftPeopleAt: number | null = null;
/** People pages open right now (the old one is still open while the next builds). */
let openPages = 0;

/** Call once as a People page opens: does this opening need the PIN? */
export function peopleEntryNeedsPinNow(): boolean {
  return peopleEntryNeedsPin({ now: Date.now(), leftPeopleAt, lastActiveAt, stillInside: openPages > 0 });
}

/**
 * While a People page is open and unlocked: any touch, click, key, scroll or
 * mouse movement counts as active; 20 seconds of none locks People — the
 * screen asks for the private PIN and the server's unlock is closed too.
 */
export function usePeopleIdleLock(unlocked: boolean): void {
  const { requireSensitivePin } = useAuth();
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
    const timer = window.setInterval(() => {
      if (!peopleIdleExpired(lastActiveAt, Date.now())) return;
      lastActiveAt = null;
      void fetch(`${BASE}/api/auth/people-pin/lock`, { method: "POST", credentials: "include" }).catch(() => {});
      requireSensitivePin({ includeAdmins: true, scope: "people", fresh: true });
    }, 1000);
    return () => {
      for (const e of events) document.removeEventListener(e, active, opts);
      document.removeEventListener("pointermove", onMove, opts);
      window.clearInterval(timer);
    };
    // requireSensitivePin changes identity with the lock state; the effect
    // re-arms on `unlocked`, which is the change that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);
}
