/**
 * The founder's way into The Business on a touch screen (Graeme,
 * 2026-10-10; Objective I): a big left-to-right swipe starting anywhere in
 * the left half of the screen. On iPads and phones The Business comes out
 * of his menu (lib/edge-swipe.ts showBusinessInNav); with a mouse it stays
 * in the menu and this does nothing.
 *
 * FOUNDER ONLY: for anyone else it renders nothing and listens to nothing —
 * no handle, no hint, no walkthrough. Same guard rails as the quick-actions
 * swipe (never the first 20 px — Safari's back swipe; clearly sideways;
 * never from text boxes, sliders, maps, drag areas, sideways scrollers or
 * data-no-swipe; never over a pop-up, the quick-actions panel or the PIN
 * lock). While the finger moves, a "The Business" pill slides in from the
 * left so he can see it's going to happen; let go short and it slides away.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useFounderArea } from "@/hooks/use-founder-area";
import { usePointerKind } from "@/hooks/use-touch-primary";
import { ancestorChain, useSideSwipe } from "@/hooks/use-side-swipe";
import {
  blockedByAncestors, businessSwipeEnabled, inStartZone, leftSwipeCommits, LEFT_SWIPE_MIN_PX, LEFT_SWIPE_SHARE,
} from "@/lib/edge-swipe";
import { fullScreenOverlayShowing, useAnyPromptShowing } from "@/lib/prompt-presence";

export function BusinessSwipe() {
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
