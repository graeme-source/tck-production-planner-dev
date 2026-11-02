/**
 * "Print kanban card(s)" — pick the paper, open the PDF (objective C).
 *
 * On a desktop each choice is an ordinary link to the server-made PDF,
 * opened in a new tab on the click itself (see lib/kanban-print.ts for why
 * the old popup failed). On an iPad, or when the app runs from its
 * home-screen icon, that new tab has no Share or Print button (#365), so
 * the PDF is fetched as soon as the dialog opens and the tap hands it to the
 * share sheet, which has Print. The PDF is the exact size; the guidance
 * below is what stops the printer shrinking it.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { FileDown, Loader2, Printer, Scissors } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { isStandalone } from "@/lib/push";
import {
  KANBAN_SHEET_OPTIONS,
  kanbanCardsPdfUrl,
  kanbanPdfFileName,
  kanbanPrintIds,
  kanbanPrintMethod,
  looksLikeIpad,
  type KanbanSheet,
} from "@/lib/kanban-print";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface KanbanPrintItem { id: number; name: string }

function canSharePdfFiles(): boolean {
  if (typeof navigator === "undefined" || typeof File === "undefined") return false;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    return nav.canShare?.({ files: [new File([""], "x.pdf", { type: "application/pdf" })] }) === true;
  } catch {
    return false;
  }
}

/** Last resort when the share sheet fails: print the PDF from a hidden frame. */
function printPdfInFrame(file: File) {
  const url = URL.createObjectURL(file);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  iframe.src = url;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      toast({ title: "Couldn't open the print dialog", description: "Try again, or print from a computer.", variant: "destructive" });
    }
    setTimeout(() => { iframe.remove(); URL.revokeObjectURL(url); }, 60_000);
  };
  document.body.appendChild(iframe);
}

export function KanbanPrintDialog({ items, onClose }: { items: KanbanPrintItem[] | null; onClose: () => void }) {
  const open = items != null && items.length > 0;
  const ids = kanbanPrintIds((items ?? []).map((i) => i.id));
  const title = ids.length === 1 ? `Print kanban card — ${items?.[0]?.name ?? ""}` : `Print ${ids.length} kanban cards`;

  const method = useMemo(() => kanbanPrintMethod({
    standalone: isStandalone(),
    ipad: typeof navigator !== "undefined" && looksLikeIpad(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    canShareFiles: canSharePdfFiles(),
  }), []);
  const [sharing, setSharing] = useState<KanbanSheet | null>(null);

  // Fetched up front so the tap can open the share sheet straight away —
  // iPadOS only allows it while the tap is still "fresh".
  const pdfs = useQueries({
    queries: KANBAN_SHEET_OPTIONS.map((opt) => ({
      queryKey: ["kanban-card-pdf", ids.join(","), opt.sheet],
      enabled: open && method === "share" && ids.length > 0,
      staleTime: 5 * 60_000,
      queryFn: async () => {
        const href = kanbanCardsPdfUrl(BASE, ids, opt.sheet);
        if (!href) throw new Error("Nothing to print");
        const res = await fetch(href, { credentials: "include" });
        if (!res.ok) throw new Error(`Could not make the kanban PDF (${res.status})`);
        const blob = await res.blob();
        return new File([blob], kanbanPdfFileName(ids.length, opt.sheet), { type: "application/pdf" });
      },
    })),
  });

  const shareSheet = async (sheet: KanbanSheet, file: File | undefined) => {
    if (!file) return;
    setSharing(sheet);
    try {
      await navigator.share({ files: [file], title });
      onClose();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // they closed the sheet
      printPdfInFrame(file);
      onClose();
    } finally {
      setSharing(null);
    }
  };

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
          {KANBAN_SHEET_OPTIONS.map((opt, idx) => {
            const href = kanbanCardsPdfUrl(BASE, ids, opt.sheet);
            if (!href) return null;
            const icon = opt.sheet === "a4" ? <Scissors className="w-5 h-5" /> : <Printer className="w-5 h-5" />;
            const body = (trailing: ReactNode) => (
              <>
                <span className="mt-0.5 rounded-xl bg-primary/10 p-2.5 text-primary">{icon}</span>
                <span className="flex-1">
                  <span className="block font-semibold text-foreground">{opt.title}</span>
                  <span className="block text-sm text-muted-foreground">{opt.detail}</span>
                </span>
                {trailing}
              </>
            );
            const rowClass = "flex items-start gap-4 rounded-2xl border border-border bg-secondary/20 p-4 hover:bg-secondary/50 transition-colors min-h-[72px] text-left w-full";

            if (method === "share") {
              const q = pdfs[idx];
              const ready = q?.data != null;
              return (
                <button
                  key={opt.sheet}
                  type="button"
                  disabled={!ready || sharing != null}
                  onClick={() => shareSheet(opt.sheet, q?.data)}
                  className={`${rowClass} disabled:opacity-60`}
                >
                  {body(
                    q?.isError
                      ? <span className="text-xs text-destructive mt-0.5">Couldn't load — close and try again</span>
                      : ready && sharing !== opt.sheet
                        ? <Printer className="w-5 h-5 text-muted-foreground mt-0.5" />
                        : <Loader2 className="w-5 h-5 text-muted-foreground mt-0.5 animate-spin" />,
                  )}
                </button>
              );
            }

            return (
              <a
                key={opt.sheet}
                href={href}
                target="_blank"
                rel="noopener"
                onClick={() => onClose()}
                className={rowClass}
              >
                {body(<FileDown className="w-5 h-5 text-muted-foreground mt-0.5" />)}
              </a>
            );
          })}
        </div>

        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-800">
          <p className="font-semibold">So every card comes out the same size</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {method === "share" ? (
              <li>Tap the paper you're using, then tap <strong>Print</strong> in the menu that opens.</li>
            ) : (
              <li>The PDF opens in a new tab. Print it from there — don't screenshot it.</li>
            )}
            <li>Set scale to <strong>Actual size</strong> / <strong>100%</strong> — not "Fit to page" or "Shrink to fit".</li>
            <li>Print single-sided. The card folds; it isn't printed on both sides.</li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
