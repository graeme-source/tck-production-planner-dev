import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pull-to-refresh for the PWA standalone mode.
 *
 * When the app is launched from the iOS/Android home-screen shortcut it runs
 * in a fullscreen WebView that has no browser chrome and therefore no native
 * pull-to-refresh. Users still expect the familiar "drag down to reload"
 * gesture, so this component synthesises one:
 *
 *  1. Only activates when the page is running in standalone display mode
 *     (matchMedia("display-mode: standalone") OR iOS Safari's non-standard
 *     navigator.standalone flag). In a normal browser tab the native gesture
 *     still works and we don't want to fire twice.
 *  2. Listens to touchstart / touchmove / touchend at the document level.
 *     A pull only registers when the page is scrolled to the very top
 *     (window.scrollY === 0) and the user moves their finger down.
 *  3. While the finger is down, a fixed-position indicator slides into view
 *     and rotates with the pull distance. If the user releases past the
 *     threshold (80px), the page reloads. Otherwise the indicator animates
 *     back out.
 */
const THRESHOLD = 160; // px the user must drag before a reload triggers (iPad-friendly)
const MAX_PULL = 220; // visual cap so the indicator doesn't keep growing
const DEAD_ZONE = 30; // px of initial vertical movement before we treat it as a pull

export function PullToRefresh() {
  const [enabled, setEnabled] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startYRef = useRef<number | null>(null);
  const activeRef = useRef(false);

  // Detect standalone mode once on mount. If the user later shares the URL in
  // a normal browser tab this component stays inactive — that's fine, the
  // browser handles it.
  useEffect(() => {
    type NavStandalone = Navigator & { standalone?: boolean };
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as NavStandalone).standalone === true;
    // Allow developers to smoke-test the gesture in a normal browser tab by
    // setting localStorage.pullToRefreshDev = "1".
    let forced = false;
    try {
      forced = window.localStorage?.getItem("pullToRefreshDev") === "1";
    } catch { /* storage blocked — ignore */ }
    setEnabled(!!isStandalone || forced);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function onTouchStart(e: TouchEvent) {
      if (refreshing) return;
      if (window.scrollY > 0) return;
      if (e.touches.length !== 1) return;
      startYRef.current = e.touches[0].clientY;
      activeRef.current = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (refreshing) return;
      if (startYRef.current === null) return;
      // If the user has scrolled during the gesture, abort.
      if (window.scrollY > 0) {
        startYRef.current = null;
        activeRef.current = false;
        setPullDistance(0);
        return;
      }
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        // Upward — not a pull, ignore.
        setPullDistance(0);
        return;
      }
      // Ignore small movements so a casual scroll-up doesn't trigger the pull.
      if (dy < DEAD_ZONE) return;
      const effective = dy - DEAD_ZONE;
      // Resistance curve: the pull feels heavier past the threshold so users
      // get tactile feedback even on long drags.
      const resisted = effective < THRESHOLD ? effective : THRESHOLD + (effective - THRESHOLD) * 0.4;
      const capped = Math.min(resisted, MAX_PULL);
      setPullDistance(capped);
      activeRef.current = capped > 5;
      // Prevent the browser's rubber-band scroll while we're visually
      // handling the pull. passive:false is required below.
      if (activeRef.current && e.cancelable) e.preventDefault();
    }

    function onTouchEnd() {
      if (refreshing) return;
      if (startYRef.current === null) {
        setPullDistance(0);
        return;
      }
      const crossed = pullDistance >= THRESHOLD;
      startYRef.current = null;
      activeRef.current = false;
      if (crossed) {
        setRefreshing(true);
        setPullDistance(THRESHOLD);
        // Small delay so the spinner is visible before the navigation tears
        // down the React tree.
        setTimeout(() => window.location.reload(), 200);
      } else {
        setPullDistance(0);
      }
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
    // pullDistance is read inside onTouchEnd, so we re-bind when it changes.
  }, [enabled, pullDistance, refreshing]);

  if (!enabled) return null;

  const visible = pullDistance > 5 || refreshing;
  const progress = Math.min(pullDistance / THRESHOLD, 1);
  const ready = progress >= 1;
  // Translate from hidden (above the viewport) down into view as the user
  // pulls. When refreshing, snap to a fixed offset and spin the loader.
  const translateY = refreshing ? 48 : Math.max(0, pullDistance * 0.7 - 16);

  return (
    <div
      aria-hidden={!visible}
      className="fixed inset-x-0 top-0 flex justify-center pointer-events-none z-[200] transition-opacity"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div
        className={cn(
          "mt-2 flex items-center justify-center w-10 h-10 rounded-full border shadow-lg bg-card",
          ready || refreshing
            ? "border-primary text-primary"
            : "border-border text-muted-foreground",
        )}
        style={{
          transform: `translateY(${translateY}px)`,
          transition: refreshing ? "transform 150ms ease" : pullDistance === 0 ? "transform 200ms ease" : "none",
        }}
      >
        {refreshing ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <ArrowDown
            className="w-5 h-5 transition-transform"
            style={{ transform: `rotate(${ready ? 180 : progress * 180}deg)` }}
          />
        )}
      </div>
    </div>
  );
}
