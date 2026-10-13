/**
 * The pinned save bar (Graeme, 2026-10-12 recipe editors; 2026-10-13 People
 * reviews: "make this save button always be at the bottom of this panel so I
 * don't have to go and find it"). Objective H.
 *
 *   • <PinnedBody> is a modal card's body + footer: the body scrolls INSIDE
 *     (the card is capped at 92dvh by its shell) and the footer sits under
 *     it, always in view on a phone and an iPad in landscape. The footer is
 *     hidden while nothing is in it.
 *   • <PinnedFooter> puts its children into the nearest footer through a
 *     portal, so a form keeps its own state and buttons but they are drawn
 *     at the bottom of the card. Outside a pinned shell (a page, a side
 *     sheet) it draws them where it is — inline, or sticky if asked.
 *
 * Used by components/recipe-editor/editor-dialog.tsx and
 * components/people-modal.tsx.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const FooterSlot = createContext<HTMLElement | null>(null);

/** The brand-green full-width save button look (Fresh Basil #7cb342). */
export const pinnedPrimaryClass =
  "w-full min-h-14 rounded-2xl bg-[#7cb342] text-white hover:bg-[#6a9c37] text-lg font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60";

export function PinnedBody({ children, bodyClassName, footerClassName, bodyTestId, footerTestId }: {
  children: ReactNode;
  bodyClassName?: string;
  footerClassName?: string;
  bodyTestId?: string;
  footerTestId?: string;
}) {
  const [footerEl, setFooterEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <div className={cn("flex-1 min-h-0 overflow-y-auto overscroll-contain", bodyClassName)} data-testid={bodyTestId}>
        <FooterSlot.Provider value={footerEl}>{children}</FooterSlot.Provider>
      </div>
      <div
        ref={setFooterEl}
        className={cn("shrink-0 border-t border-border bg-card empty:hidden", footerClassName)}
        data-testid={footerTestId}
        data-pinned-footer=""
      />
    </>
  );
}

/** True when there's a pinned footer to draw into. */
export function useHasPinnedFooter(): boolean {
  return useContext(FooterSlot) != null;
}

export function PinnedFooter({ children, fallback = "inline" }: {
  children: ReactNode;
  /** With no pinned shell around it: draw in place, or stick to the bottom of the scroller. */
  fallback?: "inline" | "sticky";
}) {
  const slot = useContext(FooterSlot);
  if (slot) return createPortal(children, slot);
  return fallback === "sticky" ? <div className="sticky bottom-0 bg-card pt-3">{children}</div> : <>{children}</>;
}
