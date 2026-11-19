/**
 * "Is this right?" before a file goes onto a card transaction (Graeme,
 * 19 Nov 2026: he attached an order confirmation, it was saved as the
 * invoice and the transaction jumped to the Inbox before he could change
 * it). Shows the file, asks what it is — nothing is preselected — and says
 * where the transaction will go: a VAT invoice moves it to the Inbox,
 * anything else keeps it in Outstanding, still chasing the VAT invoice.
 * Modal rules: X + backdrop close, max-h-[92dvh], internal scroll.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Inbox, Loader2, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type DocKindOption = { value: string; label: string };

function useObjectUrl(file: File | null): string | null {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

function Preview({ file }: { file: File }) {
  const url = useObjectUrl(file);
  if (!url) return null;
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) return <iframe src={`${url}#view=FitH`} title={file.name} className="w-full h-[40dvh] rounded-xl border bg-white" />;
  if (file.type.startsWith("image/") && !/hei[cf]/i.test(file.type)) {
    return <img src={url} alt={file.name} className="w-full max-h-[40dvh] object-contain rounded-xl border bg-secondary/30" />;
  }
  return null;
}

export function AttachConfirmDialog({ files, kinds, what, busy, onCancel, onConfirm }: {
  files: File[] | null;
  kinds: DocKindOption[];
  /** The transaction, in one line: "Starrymart · £116.10 on 17 Nov · card 2786 · Lorna Brown". */
  what: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (kind: string) => void;
}) {
  const [kind, setKind] = useState<string | null>(null);
  useEffect(() => { if (files) setKind(null); }, [files]);
  if (!files || files.length === 0) return null;
  const close = () => { if (!busy) onCancel(); };
  const toInbox = kind === "invoice";
  return createPortal(
    <div className="fixed inset-0 z-[160] bg-black/50 flex items-center justify-center p-3 sm:p-6" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="attach-confirm-title"
        className="bg-background rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 id="attach-confirm-title" className="text-2xl font-bold leading-tight">What are you attaching?</h2>
            <p className="text-sm text-muted-foreground break-words mt-0.5">To: {what}</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" disabled={busy}
            className="w-11 h-11 rounded-full hover:bg-secondary flex items-center justify-center shrink-0 disabled:opacity-50">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {files.map((f) => (
            <div key={`${f.name}-${f.size}`} className="space-y-2">
              <div className="flex items-center gap-2 font-semibold break-words"><Paperclip className="h-4 w-4 shrink-0" /> {f.name}</div>
              <Preview file={f} />
            </div>
          ))}

          <div className="space-y-2">
            <div className="text-lg font-bold">This is a…</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {kinds.map((k) => (
                <button key={k.value} type="button" aria-pressed={kind === k.value} onClick={() => setKind(k.value)}
                  className={cn(
                    "min-h-[56px] rounded-2xl border-2 px-4 text-left text-base font-semibold transition-colors",
                    kind === k.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/50",
                  )}>
                  {k.label}
                </button>
              ))}
            </div>
            {kind && (
              <p className={cn("rounded-xl px-3 py-2 text-sm font-medium flex items-start gap-2",
                toInbox ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200")}>
                {toInbox
                  ? <><Inbox className="h-4 w-4 mt-0.5 shrink-0" /> The transaction moves to the Inbox, ready to post.</>
                  : <><ArrowRight className="h-4 w-4 mt-0.5 shrink-0" /> It stays in Outstanding — we still need the VAT invoice to reclaim the VAT.</>}
              </p>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border flex gap-3">
          <button type="button" onClick={close} disabled={busy}
            className="flex-1 min-h-[56px] rounded-xl border-2 border-border font-semibold text-lg disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => kind && onConfirm(kind)} disabled={!kind || busy}
            className="flex-1 min-h-[56px] rounded-xl bg-primary text-primary-foreground font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-40">
            {busy && <Loader2 className="h-5 w-5 animate-spin" />} {kind ? "Attach" : "Choose what it is"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
