import { useEffect, useRef } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** How often, at most, typing keeps the People lock open. Well inside the
 *  server's 15-minute sliding window (lib/people-unlock.ts). */
export const KEEP_ALIVE_EVERY_MS = 3 * 60 * 1000;

/** True when it's time to ping again after this bit of typing. Pure. */
export function shouldPingKeepAlive(lastPingAt: number | null, now: number, everyMs = KEEP_ALIVE_EVERY_MS): boolean {
  return lastPingAt == null || now - lastPingAt >= everyMs;
}

/**
 * While someone is TYPING on a People page, keep the private-PIN lock open
 * (Graeme, 2026-10-12: a 15-minute write-up was refused at Save). Only real
 * typing counts, so an iPad left open on a record still locks as before.
 */
export function usePeopleKeepAlive(enabled: boolean): void {
  const lastPing = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    lastPing.current = Date.now(); // the page's own load just slid the window
    const onType = () => {
      const now = Date.now();
      if (!shouldPingKeepAlive(lastPing.current, now)) return;
      lastPing.current = now;
      void fetch(`${BASE}/api/people/keep-alive`, { credentials: "include" }).catch(() => {});
    };
    document.addEventListener("input", onType, true);
    document.addEventListener("keydown", onType, true);
    return () => {
      document.removeEventListener("input", onType, true);
      document.removeEventListener("keydown", onType, true);
    };
  }, [enabled]);
}
