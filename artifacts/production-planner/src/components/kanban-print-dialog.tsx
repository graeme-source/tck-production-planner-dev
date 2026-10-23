/**
 * "Print kanban card(s)" — pick the paper, open the PDF (objective C).
 *
 * Each choice is an ordinary link to the server-made PDF, opened in a new
 * tab on the click itself (see lib/kanban-print.ts for why the old popup
 * failed). The PDF is the exact size; the guidance below is what stops the
 * printer shrinking it.
 */
import { FileDown, Printer, Scissors } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KANBAN_SHEET_OPTIONS, kanbanCardsPdfUrl, kanbanPrintIds } from "@/lib/kanban-print";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface KanbanPrintItem { id: number; name: string }

export function KanbanPrintDialog({ items, onClose }: { items: KanbanPrintItem[] | null; onClose: () => void }) {
  const open = items != null && items.length > 0;
  const ids = kanbanPrintIds((items ?? []).map((i) => i.id));
  const title = ids.length === 1 ? `Print kanban card — ${items?.[0]?.name ?? ""}` : `Print ${ids.length} kanban cards`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[560px] max-h-[92dvh] overflow-y-auto bg-card border-border rounded-2xl">
        <DialogHeader>
          <DialogTitle className="pr-8 break-words">{title}</DialogTitle>
          <DialogDescription>
            {ids.length === 1 ? "One sheet" : `${ids.length} sheets, one card per sheet`}: front on the top half, back
            upside down on the bottom half. Fold on the dashed line and it's the A6 card.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {KANBAN_SHEET_OPTIONS.map((opt) => {
            const href = kanbanCardsPdfUrl(BASE, ids, opt.sheet);
            if (!href) return null;
            return (
              <a
                key={opt.sheet}
                href={href}
                target="_blank"
                rel="noopener"
                onClick={() => onClose()}
                className="flex items-start gap-4 rounded-2xl border border-border bg-secondary/20 p-4 hover:bg-secondary/50 transition-colors min-h-[72px]"
              >
                <span className="mt-0.5 rounded-xl bg-primary/10 p-2.5 text-primary">
                  {opt.sheet === "a4" ? <Scissors className="w-5 h-5" /> : <Printer className="w-5 h-5" />}
                </span>
                <span className="flex-1">
                  <span className="block font-semibold text-foreground">{opt.title}</span>
                  <span className="block text-sm text-muted-foreground">{opt.detail}</span>
                </span>
                <FileDown className="w-5 h-5 text-muted-foreground mt-0.5" />
              </a>
            );
          })}
        </div>

        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-800">
          <p className="font-semibold">So every card comes out the same size</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            <li>The PDF opens in a new tab. Print it from there — don't screenshot it.</li>
            <li>Set scale to <strong>Actual size</strong> / <strong>100%</strong> — not "Fit to page" or "Shrink to fit".</li>
            <li>Print single-sided. The card folds; it isn't printed on both sides.</li>
            <li>On an iPad: tap Share, then Print.</li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
