import { useState, useEffect, useCallback, useRef } from "react";

export type NetworkStatus = "online" | "offline";

// One-off failures (Railway redeploy mid-request, iPad wifi blip, captive
// portal weirdness) shouldn't immediately yank the banner up. Operators kept
// reloading the page when the banner appeared during transient hiccups; we
// only flip to "offline" once we've confirmed the connection is genuinely
// down by failing this many verifies back-to-back.
const CONSECUTIVE_FAILURES_BEFORE_OFFLINE = 2;
const POLL_INTERVAL_MS = 8_000;

export function useNetworkStatus(): { status: NetworkStatus; retry: () => void } {
  const [status, setStatus] = useState<NetworkStatus>("online");
  const checkInFlightRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);

  const verifyConnectivity = useCallback(async () => {
    if (checkInFlightRef.current) return;
    checkInFlightRef.current = true;

    try {
      const res = await fetch("/api/auth/me", {
        method: "HEAD",
        credentials: "include",
        cache: "no-store",
      });
      // 2xx + 401 both mean the server is reachable. Anything else (5xx mid-
      // deploy, 503, etc.) is treated as a connectivity failure.
      const reachable = res.ok || res.status === 401;
      if (reachable) {
        consecutiveFailuresRef.current = 0;
        setStatus("online");
      } else {
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= CONSECUTIVE_FAILURES_BEFORE_OFFLINE) {
          setStatus("offline");
        }
      }
    } catch {
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= CONSECUTIVE_FAILURES_BEFORE_OFFLINE) {
        setStatus("offline");
      }
    } finally {
      checkInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    verifyConnectivity();

    // navigator.onLine / browser online/offline events are unreliable on iOS
    // (captive portals, brief radio drops, even some Wi-Fi handoffs fire a
    // false "offline"). We listen so the verify can run on transitions, but
    // never trust them as the source of truth — the verify call is.
    const goOnline = () => verifyConnectivity();
    const goOffline = () => verifyConnectivity();

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [verifyConnectivity]);

  useEffect(() => {
    const handleFocus = () => {
      verifyConnectivity();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [verifyConnectivity]);

  useEffect(() => {
    if (status !== "offline") return;
    const interval = setInterval(verifyConnectivity, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, verifyConnectivity]);

  return { status, retry: verifyConnectivity };
}
