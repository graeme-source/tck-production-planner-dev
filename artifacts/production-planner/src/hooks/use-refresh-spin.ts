import { useState, useCallback, useRef } from "react";

export function useRefreshSpin(minDurationMs = 600) {
  const [spinning, setSpinning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerSpin = useCallback(() => {
    setSpinning(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSpinning(false), minDurationMs);
  }, [minDurationMs]);

  return { spinning, triggerSpin };
}
