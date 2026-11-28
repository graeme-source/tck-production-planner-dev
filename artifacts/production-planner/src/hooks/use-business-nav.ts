/**
 * The Business tab strip as this person sees it, and whether this page is
 * one of the swipeable pages (Graeme, 28 Nov 2026; Objective I). Rules in
 * lib/business-pager.ts: on a touch screen "Orders" comes first and the
 * strip pages by swiping; with a mouse it's the strip as it always was.
 */
import { useLocation } from "wouter";
import { useFounderArea } from "@/hooks/use-founder-area";
import { usePointerKind } from "@/hooks/use-touch-primary";
import { businessNavTabs, pagerNeighbours, type NavTab } from "@/lib/business-pager";

export function useBusinessNavTabs(): NavTab[] {
  const { tabs, canNumbers } = useFounderArea();
  const { touchPrimary } = usePointerKind();
  return businessNavTabs({ tabs, canNumbers, touchPrimary });
}

/** On a touch screen, on a page of the strip with somewhere to swipe to. */
export function useBusinessPagerActive(): boolean {
  const tabs = useBusinessNavTabs();
  const { touchPrimary } = usePointerKind();
  const [location] = useLocation();
  return touchPrimary && pagerNeighbours(tabs.map(t => t.href), location) != null;
}
