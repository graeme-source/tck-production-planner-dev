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

/**
 * How the dialog hands the PDF over (fix-queue #365, Jane Miles 27 Oct).
 *
 * Opened from its home-screen icon, the app runs without Safari's toolbar,
 * so the new-tab PDF fills the screen with no Share or Print button — there
 * was no way to print. On an iPad, or whenever the app runs from its icon,
 * the PDF goes to the share sheet instead (it has Print). Desktops keep the
 * plain new-tab link, which prints fine there.
 */
export type KanbanPrintMethod = "share" | "link";

export interface KanbanPrintEnv {
  /** Running from the home-screen icon (display-mode standalone). */
  standalone: boolean;
  /** An iPad — including iPadOS reporting itself as a Mac. */
  ipad: boolean;
  /** navigator.share can take a PDF file. */
  canShareFiles: boolean;
}

export function kanbanPrintMethod(env: KanbanPrintEnv): KanbanPrintMethod {
  if (!env.canShareFiles) return "link";
  return env.standalone || env.ipad ? "share" : "link";
}

/** iPadOS 13+ says "Macintosh" in its user agent; touch points give it away. */
export function looksLikeIpad(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** File name for the shared PDF, e.g. "kanban-card-a5.pdf" / "kanban-cards-a4.pdf". */
export function kanbanPdfFileName(count: number, sheet: KanbanSheet): string {
  return `kanban-card${count === 1 ? "" : "s"}-${sheet}.pdf`;
}
