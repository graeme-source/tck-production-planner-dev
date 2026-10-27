/**
 * Top bar layout on tablet/desktop (fix-queue #359, Jane Miles 27 Oct).
 *
 * The bar used to be one row that never wrapped, so on an iPad with the side
 * menu open a page with several header buttons (Inventory: QR codes, Analyze
 * UPF, Print kanban cards, Import CSV, Add Ingredient) pushed its LAST button
 * — the main one — off the right-hand edge, where it couldn't be seen or
 * tapped. Now the bar wraps: when the page's own buttons don't fit they drop
 * onto a second row, right-aligned, and wrap again inside that row if they
 * still don't fit. Nothing is ever clipped.
 */
export const TOP_BAR_CLASS =
  "min-h-[56px] py-2 border-b border-border bg-background/80 backdrop-blur-md flex flex-wrap items-center gap-x-3 gap-y-2 px-4 md:px-5 xl:px-8 z-10 min-w-0";

/** The page's own buttons: right-aligned, never wider than the bar, and the
 *  page's button group may wrap (the primary button stays last). */
export const TOP_BAR_ACTIONS_CLASS =
  "ml-auto max-w-full min-w-0 [&>*]:flex-wrap [&>*]:justify-end";
