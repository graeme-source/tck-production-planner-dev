/**
 * Kanban card printing — where the PDF lives (objective C).
 *
 * Why this is a plain link and not a popup: the old Print button fetched the
 * card data and THEN called window.open(). By then the click's "user
 * gesture" had been used up by the await, so Safari (desktop and iPad) and
 * stricter Edge/Chrome settings blocked the popup — and the code returned
 * silently, so nothing happened. When it did open, it printed two separate
 * A6 pages sized by whatever the browser and printer guessed. Now the
 * server makes a real PDF at the exact size and the button is an ordinary
 * <a target="_blank"> to it, which every browser opens on the click itself.
 */

export type KanbanSheet = "a5" | "a4";

export const MAX_KANBAN_CARDS_PER_PDF = 200;

/** Unique positive ids, in the order given, capped at the server's limit. */
export function kanbanPrintIds(ids: readonly number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length === MAX_KANBAN_CARDS_PER_PDF) break;
  }
  return out;
}

/** Same-origin URL of the kanban PDF (base = the app's BASE_URL without a
 *  trailing slash). Null when there is nothing to print. */
export function kanbanCardsPdfUrl(base: string, ids: readonly number[], sheet: KanbanSheet): string | null {
  const clean = kanbanPrintIds(ids);
  if (clean.length === 0) return null;
  return `${base.replace(/\/$/, "")}/api/kanban-cards/pdf?ids=${clean.join(",")}&sheet=${sheet}`;
}

export const KANBAN_SHEET_OPTIONS: { sheet: KanbanSheet; title: string; detail: string }[] = [
  {
    sheet: "a5",
    title: "A5 paper",
    detail: "One A5 sheet per card. Put A5 paper in the printer and pick A5 as the paper size.",
  },
  {
    sheet: "a4",
    title: "A4 paper (trim to A5)",
    detail: "The same A5 card in the middle of an A4 sheet, with corner marks to trim on.",
  },
];
