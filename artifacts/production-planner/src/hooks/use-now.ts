import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs` (for countdowns). Ticks are
 * aligned to the wall clock (e.g. on :00 and :30 for 30 s), so several
 * countdowns on one screen always change together and never disagree.
 */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = intervalMs - (Date.now() % intervalMs) || intervalMs;
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    setNow(new Date());
    schedule();
    return () => clearTimeout(timer);
  }, [intervalMs]);
  return now;
}
