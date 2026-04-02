import { useState, useCallback, useRef, useEffect } from "react";

/**
 * Tracks when data was last successfully fetched.
 * Returns a `markFresh()` callback to call on successful fetch,
 * and a `staleSeconds` value for display.
 *
 * Usage:
 *   const { markFresh, staleSeconds, isStale } = useStaleTracker(30);
 *   // In your fetch .then(): markFresh()
 *   // In your JSX: {isStale && <span>Data {staleSeconds}s old</span>}
 */
export function useStaleTracker(staleThresholdSec = 30) {
  const lastFetchRef = useRef<number>(Date.now());
  const [staleSeconds, setStaleSeconds] = useState(0);

  const markFresh = useCallback(() => {
    lastFetchRef.current = Date.now();
    setStaleSeconds(0);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.round((Date.now() - lastFetchRef.current) / 1000);
      setStaleSeconds(elapsed);
    }, 5000); // Check every 5s
    return () => clearInterval(interval);
  }, []);

  return {
    markFresh,
    staleSeconds,
    isStale: staleSeconds >= staleThresholdSec,
  };
}
