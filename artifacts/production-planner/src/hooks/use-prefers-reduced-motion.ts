import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** True while the device asks for reduced motion — follows the setting live.
 *  Shared by the swipe panel and the before/after fade. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
