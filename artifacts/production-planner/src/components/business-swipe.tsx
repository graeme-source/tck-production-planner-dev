/**
 * Sideways swipes that SLIDE PAGES, iPhone home-screen style (Graeme,
 * 2026-10-10, reworked 28 Nov 2026; Objective I). Touch screens only — with
 * a mouse this listens to nothing and The Business is clicked as normal.
 *
 *   - INTO THE BUSINESS (the founder only, BusinessSwipeInto below): from
 *      any other page, a left-to-right swipe in the left half of the screen
 *      shows a "The Business" pill, then goes to Numbers.
 *   - THROUGH THE BUSINESS (anyone with two or more Business tabs): on a
 *      page of the Business tab strip, a sideways drag anywhere on the page
 *      turns to the neighbouring tab in strip order — left-to-right reveals
 *      the tab on the left (Numbers → Orders), right-to-left the one on the
 *      right (Numbers → Ads). Past either end it resists and springs back.
 *      Rules: lib/business-pager.ts. Here the quick-actions panel opens
 *      from its handle only, since right-to-left turns the page.
 *
 * The page coming in is a SNAPSHOT of how it looked when last seen (a copy
 * of its page area, refreshed every 20 s while it's open, kept 30 min), or a
 * light stand-in with its tab strip and title if it hasn't been opened yet.
 * Rendering the real neighbour pages alongside would fire every one of
 * their queries on every page. Once the slide finishes the app moves to the
 * page under the cover, which then fades away — the real page in place.
 *
 * Guard rails kept from the first version: never the first or last 20 px
 * (Safari's back/forward swipe); clearly sideways and 24 px before anything
 * moves; never from text boxes, sliders, maps, drag-and-drop areas,
 * sideways scrollers (the Every order table on a phone scrolls, it doesn't
 * page) or data-no-swipe; never over a pop-up, the quick-actions panel, a
 * must-answer prompt or the PIN lock. "Reduce motion" moves without the
 * slide.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { useFounderArea } from "@/hooks/use-founder-area";
import { usePointerKind } from "@/hooks/use-touch-primary";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { useBusinessNavTabs } from "@/hooks/use-business-nav";
import { ancestorChain, useSideSwipe } from "@/hooks/use-side-swipe";
import { Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  blockedByAncestors, businessSwipeEnabled, inStartZone, leftSwipeCommits, EDGE_GUARD_PX, LEFT_SWIPE_MIN_PX, LEFT_SWIPE_SHARE,
} from "@/lib/edge-swipe";
import {
  pagerFollow, pagerNeighbours, pagerSnap, settleDurationMs, SETTLE_EASING, type NavTab,
} from "@/lib/business-pager";
import { fullScreenOverlayShowing, useAnyPromptShowing } from "@/lib/prompt-presence";
import { FounderNav } from "@/components/founder-nav";
import { Skeleton } from "@/components/ui/skeleton";

// ── Snapshots of the Business pages, for the page sliding in ──────────────
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
const snapshots = new Map<string, { el: HTMLElement; at: number }>();

function takeSnapshot(href: string, page: HTMLElement): void {
  const el = page.cloneNode(true) as HTMLElement;
  // Not a second #app-main-scroll; never scrolls; none of the drag's styles.
  el.removeAttribute("id");
  el.removeAttribute("data-swipe-page");
  el.style.transform = "";
  el.style.transition = "";
  el.style.willChange = "";
  el.style.overflow = "hidden";
  snapshots.set(href, { el, at: Date.now() });
}

function freshSnapshot(href: string): HTMLElement | null {
  const s = snapshots.get(href);
  if (!s) return null;
  if (Date.now() - s.at > SNAPSHOT_MAX_AGE_MS) { snapshots.delete(href); return null; }
  return s.el;
}

// ── Arriving by a slide: the layout skips its usual fade-in ───────────────
let arrival: { href: string; at: number } | null = null;
/** True just after a swipe moved to `href` — the page is already in place,
 *  so the layout's fade-and-rise would be a visible jump. */
export function arrivedBySlide(href: string): boolean {
  return !!arrival && arrival.href === href && Date.now() - arrival.at < 1500;
}

/** The page coming in: its snapshot, or a stand-in with its strip and title. */
function IncomingPage({ tab, width, x, layerRef }: { tab: NavTab; width: number; x: number; layerRef: RefObject<HTMLDivElement | null> }) {
  const [snap] = useState(() => freshSnapshot(tab.href));
  const holder = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!snap || !holder.current) return;
    holder.current.appendChild(snap);
    return () => { snap.remove(); };
  }, [snap]);
  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      inert
      className="absolute inset-y-0 left-0 flex overflow-hidden bg-background pointer-events-none"
      style={{ width, transform: `translate3d(${x}px,0,0)` }}
    >
      {snap ? <div ref={holder} className="flex flex-1 min-w-0" /> : (
        <div className="flex-1 min-w-0 p-4 md:p-8 space-y-8">
          <FounderNav activeHref={tab.href} />
          <h2 className="text-2xl font-display font-bold">{tab.label}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
          </div>
        </div>
      )}
    </div>
  );
}

interface Gesture {
  mode: "pager";
  left: NavTab | null;
  right: NavTab | null;
  width: number;
  offset: number;
  from: string;
  shown: boolean;
}

/** Mounted inside the layout, beside the page area it slides (`pageRef`). */
export function BusinessSwipe({ pageRef }: { pageRef: RefObject<HTMLDivElement | null> }) {
  const pointer = usePointerKind();
  const tabs = useBusinessNavTabs();
  const [location, navigate] = useLocation();
  const { pinLocked, peoplePinPrompt, peoplePinSetupPrompt } = useAuth();
  const promptShowing = useAnyPromptShowing();
  const reduced = usePrefersReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const neighbours = pointer.touchPrimary ? pagerNeighbours(tabs.map(t => t.href), location) : null;
  const guardsClear = !pinLocked && !peoplePinPrompt && !peoplePinSetupPrompt && !promptShowing;
  const enabled = guardsClear && !!neighbours;

  const [layers, setLayers] = useState<{ left: NavTab | null; right: NavTab | null; width: number; offset: number } | null>(null);
  const g = useRef<Gesture | null>(null);
  const busy = useRef(false);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const tabFor = (href: string | null): NavTab | null => (href ? tabs.find(t => t.href === href) ?? null : null);

  // Keep this page's snapshot fresh while it's open.
  const onPagerPage = !!neighbours;
  useEffect(() => {
    if (!onPagerPage) return;
    const href = location;
    const snap = () => {
      if (busy.current || g.current?.shown || !pageRef.current) return;
      takeSnapshot(href, pageRef.current);
    };
    const t1 = window.setTimeout(snap, 1500);
    const t2 = window.setTimeout(snap, 5000);
    const iv = window.setInterval(snap, 20000);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); window.clearInterval(iv); };
  }, [onPagerPage, location, pageRef]);

  const place = (offset: number) => {
    const gg = g.current;
    const page = pageRef.current;
    if (!gg || !page) return;
    gg.offset = offset;
    page.style.transform = `translate3d(${offset}px,0,0)`;
    if (leftRef.current) leftRef.current.style.transform = `translate3d(${offset - gg.width}px,0,0)`;
    if (rightRef.current) rightRef.current.style.transform = `translate3d(${offset + gg.width}px,0,0)`;
  };
  const setTransition = (ms: number) => {
    const t = ms > 0 ? `transform ${ms}ms ${SETTLE_EASING}` : "";
    for (const el of [pageRef.current, leftRef.current, rightRef.current]) if (el) el.style.transition = t;
  };
  // Never leave a transform on the page: it would trap its fixed pop-ups.
  const resetPage = () => {
    const page = pageRef.current;
    if (!page) return;
    page.style.transform = "";
    page.style.transition = "";
    page.style.willChange = "";
  };
  const done = () => { g.current = null; busy.current = false; setLayers(null); };
  const springHome = () => { resetPage(); done(); };

  /** Slide everything to `to` (px), starting at the finger's speed, then `then`. */
  const settle = (to: number, velocity: number, then: () => void) => {
    const gg = g.current;
    const page = pageRef.current;
    if (!gg || !page) { then(); return; }
    busy.current = true;
    const ms = reducedRef.current ? 0 : settleDurationMs({ fromPx: gg.offset, toPx: to, velocityPxPerMs: velocity, width: gg.width });
    if (ms === 0) {
      setTransition(0);
      place(to);
      requestAnimationFrame(then);
      return;
    }
    setTransition(ms);
    place(to);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      page.removeEventListener("transitionend", onEnd);
      window.clearTimeout(timer);
      setTransition(0);
      then();
    };
    const onEnd = (e: TransitionEvent) => { if (e.target === page && e.propertyName === "transform") finish(); };
    page.addEventListener("transitionend", onEnd);
    const timer = window.setTimeout(finish, ms + 80);
  };

  /** The slide has finished on `dest`: move there under the cover, then lift it. */
  const arrive = (dest: NavTab, layer: RefObject<HTMLDivElement | null>) => {
    const gg = g.current;
    const page = pageRef.current;
    if (gg && page) takeSnapshot(gg.from, page);
    arrival = { href: dest.href, at: Date.now() };
    resetPage();
    navigate(dest.href);
    // Give the real page a moment to draw under the cover (its data is
    // usually cached), then fade the cover off it.
    window.setTimeout(() => requestAnimationFrame(() => {
      const el = layer.current;
      if (!el || reducedRef.current) { done(); return; }
      el.style.transition = "opacity 140ms ease-out";
      el.style.opacity = "0";
      window.setTimeout(done, 160);
    }), 60);
  };

  useSideSwipe({
    begin: ({ x, target }) => {
      if (busy.current) return null;
      const page = pageRef.current;
      if (!page) return null;
      const vw = window.innerWidth;
      if (!neighbours) return null;
      // Anywhere on the page itself, any height, but not the edges.
      if (!page.contains(target)) return null;
      if (x < EDGE_GUARD_PX || x > vw - EDGE_GUARD_PX) return null;
      if (blockedByAncestors(ancestorChain(target))) return null;
      if (document.querySelector("[data-side-swipe-busy]") || fullScreenOverlayShowing()) return null;
      const width = page.getBoundingClientRect().width;
      g.current = { mode: "pager", left: tabFor(neighbours.prev), right: tabFor(neighbours.next), width, offset: 0, from: location, shown: false };
      return { direction: 0 };
    },
    onDrag: dx => {
      const gg = g.current;
      const page = pageRef.current;
      if (!gg || !page || busy.current) return;
      const off = pagerFollow(dx, { width: gg.width, hasPrev: !!gg.left, hasNext: !!gg.right });
      if (!gg.shown) {
        gg.shown = true;
        page.style.willChange = "transform";
        setLayers({ left: gg.left, right: gg.right, width: gg.width, offset: off });
      }
      place(off);
    },
    onRelease: (dx, velocity) => {
      const gg = g.current;
      if (!gg || busy.current) return;
      if (!gg.shown) { g.current = null; return; }
      const r = pagerSnap({ dx, velocityPxPerMs: velocity, width: gg.width, hasPrev: !!gg.left, hasNext: !!gg.right });
      if (r === "prev") settle(gg.width, velocity, () => arrive(gg.left!, leftRef));
      else if (r === "next") settle(-gg.width, velocity, () => arrive(gg.right!, rightRef));
      else settle(0, velocity, springHome);
    },
    onCancel: () => {
      const gg = g.current;
      if (!gg || busy.current) return;
      if (!gg.shown) { g.current = null; return; }
      settle(0, 0, springHome);
    },
  }, enabled);

  // Something took the page away mid-gesture (a pop-up, the PIN lock):
  // put it straight back.
  useEffect(() => {
    if (enabled || !g.current || busy.current) return;
    resetPage();
    done();
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!layers) return null;
  return (
    // While anything's moving, the quick-actions swipe keeps off.
    <div data-side-swipe-busy="" className="contents">
      {layers.left && <IncomingPage tab={layers.left} width={layers.width} x={layers.offset - layers.width} layerRef={leftRef} />}
      {layers.right && <IncomingPage tab={layers.right} width={layers.width} x={layers.offset + layers.width} layerRef={rightRef} />}
    </div>
  );
}

/** The founder's swipe into The Business from any other page (2026-10-10). */
export function BusinessSwipeInto() {
  const founderArea = useFounderArea();
  const pointer = usePointerKind();
  const [location, navigate] = useLocation();
  const { pinLocked, peoplePinPrompt, peoplePinSetupPrompt } = useAuth();
  const promptShowing = useAnyPromptShowing();
  const [dx, setDx] = useState<number | null>(null);

  const home = founderArea.home;
  const onBusinessPage = location.startsWith("/founder");
  const enabled = !!home
    && businessSwipeEnabled({ isFounder: founderArea.isFounder, coarsePointer: pointer.coarsePointer, canHover: pointer.canHover, onBusinessPage })
    && !pinLocked && !peoplePinPrompt && !peoplePinSetupPrompt && !promptShowing;

  useSideSwipe({
    begin: ({ x, target }) => {
      if (!inStartZone("left", x, window.innerWidth)) return null;
      if (blockedByAncestors(ancestorChain(target))) return null;
      if (document.querySelector("[data-side-swipe-busy]") || fullScreenOverlayShowing()) return null;
      return { direction: 1 };
    },
    onDrag: d => setDx(Math.max(0, d)),
    onRelease: (d, velocity) => {
      setDx(null);
      if (home && leftSwipeCommits({ dx: d, viewportWidth: window.innerWidth, velocityPxPerMs: velocity })) navigate(home);
    },
    onCancel: () => setDx(null),
  }, enabled);

  if (!enabled || dx === null) return null;
  const need = Math.max(LEFT_SWIPE_MIN_PX, window.innerWidth * LEFT_SWIPE_SHARE);
  const share = Math.min(1, dx / need);
  return (
    <div
      aria-hidden="true"
      className="fixed top-1/2 left-0 z-[96] pointer-events-none"
      style={{ transform: `translate(${-100 + share * 100}%, -50%)` }}
    >
      <div className={cn(
        "ml-3 flex items-center gap-2 rounded-2xl px-5 h-14 text-lg font-bold shadow-xl whitespace-nowrap",
        share >= 1 ? "bg-primary text-primary-foreground" : "bg-card text-foreground border border-border",
      )}>
        <Briefcase className="w-6 h-6" /> The Business
      </div>
    </div>
  );
}
