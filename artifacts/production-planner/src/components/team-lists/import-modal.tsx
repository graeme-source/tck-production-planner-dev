/**
 * Import a Todoist project into a team list: in Todoist, open the project →
 * ⋯ → "Export as template" → download the CSV, then choose it here. The
 * common repeat phrases ("every tue", "every weekday", "every mon, thu at
 * 9am") are understood; anything else comes in as every day, listed below
 * so it can be fixed. Modal rules: X / backdrop / Escape, 92dvh, internal scroll.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, X } from "lucide-react";
import { useModalScrollKeeper } from "@/hooks/use-modal-scroll";
import { useImportTodoist } from "./team-lists-api";

export function ImportModal({ listId, onClose, onEditItem }: { listId: number; onClose: () => void; onEditItem: (itemId: number) => void }) {
  useModalScrollKeeper();
  const importer = useImportTodoist(listId);
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setReadError(null);
    try {
      importer.mutate(await file.text());
    } catch {
      setReadError("Couldn't read that file.");
    }
  }

  const result = importer.data;

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Import from Todoist"
        className="bg-background border-2 border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <h2 className="font-display text-xl font-bold flex-1">Import from Todoist</h2>
          <button type="button" onClick={onClose} className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-4">
          <ol className="list-decimal pl-5 space-y-1 text-base">
            <li>In Todoist, open the project.</li>
            <li>Tap <strong>⋯</strong> → <strong>Export as template</strong> → <strong>Download CSV</strong>.</li>
            <li>Choose that file here. The tasks are added to this list.</li>
          </ol>

          {!result && (
            <label className="flex flex-col items-center justify-center gap-2 min-h-[140px] rounded-2xl border-2 border-dashed border-border hover:bg-secondary/40 cursor-pointer text-center p-4">
              {importer.isPending ? <Loader2 className="w-8 h-8 animate-spin" /> : <FileUp className="w-8 h-8" />}
              <span className="text-lg font-semibold">{importer.isPending ? `Importing ${fileName ?? ""}…` : "Choose the CSV file"}</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" disabled={importer.isPending} onChange={e => void choose(e.target.files?.[0])} />
            </label>
          )}

          {(readError || importer.error) && (
            <p className="text-red-600 flex items-start gap-2"><AlertTriangle className="w-5 h-5 shrink-0" /> {readError ?? (importer.error as Error).message}</p>
          )}

          {result && (
            <div className="space-y-3">
              <p className="text-lg font-semibold flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-6 h-6" /> {result.created} task{result.created === 1 ? "" : "s"} added
              </p>
              {result.warnings.length > 0 && (
                <div className="space-y-2">
                  <p className="font-semibold">Check {result.warnings.length === 1 ? "this one" : `these ${result.warnings.length}`} — the repeat wasn't understood:</p>
                  {result.warnings.map(w => (
                    <button key={w.itemId} type="button" onClick={() => onEditItem(w.itemId)}
                      className="w-full text-left rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 hover:bg-amber-100/60">
                      <span className="block font-semibold">{w.title}</span>
                      <span className="block text-sm text-amber-800 dark:text-amber-300">{w.warning}</span>
                    </button>
                  ))}
                </div>
              )}
              <button type="button" onClick={onClose} className="w-full min-h-[52px] rounded-2xl bg-primary text-primary-foreground text-lg font-bold">Done</button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
