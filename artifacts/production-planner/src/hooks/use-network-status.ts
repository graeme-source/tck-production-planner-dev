import { useState, useEffect, useCallback, useRef } from "react";

export type NetworkStatus = "online" | "offline";

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(
    navigator.onLine ? "online" : "offline"
  );
  const checkInFlightRef = useRef(false);

  const verifyConnectivity = useCallback(async () => {
    if (checkInFlightRef.current) return;
    checkInFlightRef.current = true;

    try {
      const res = await fetch("/api/auth/me", {
        method: "HEAD",
        credentials: "include",
        cache: "no-store",
      });
      setStatus(res.ok || res.status === 401 ? "online" : "offline");
    } catch {
      setStatus("offline");
    } finally {
      checkInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    verifyConnectivity();

    const goOnline = () => {
      verifyConnectivity();
    };

    const goOffline = () => {
      setStatus("offline");
    };

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

    const interval = setInterval(verifyConnectivity, 10_000);
    return () => clearInterval(interval);
  }, [status, verifyConnectivity]);

  return status;
}
