/**
 * Quick actions → "Add receipt or invoice" (Graeme, 17 Nov 2026): take a
 * photo or pick one (or a PDF), and it goes straight into the Finance Inbox,
 * as if uploaded with Add invoices. For whoever has the "Add receipt or
 * invoice" grant — they may not see Finance at all, so this only sends.
 * First it asks "What is this item?" (Graeme, 18 Nov 2026) — one of the
 * fixed categories, named as their QuickBooks accounts — plus an optional
 * typed note. Both land on the invoice in the Inbox, so the accounts team
 * know what they're looking at. The photo buttons wait for the category.
 * Server: POST /api/finance/invoices/quick-add.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { Camera, CheckCircle2, ImagePlus, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CategorySelect, categoryName, useFinanceCategories } from "@/components/finance/category-select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type QuickAddResult = { added: number; already: number; refused: string[] };

async function sendFiles({ files, note, categoryId }: { files: File[]; note: string; categoryId: number }): Promise<QuickAddResult> {
  const form = new FormData();
  form.append("categoryId", String(categoryId));
  form.append("note", note.trim());
  files.forEach((f) => form.append("files", f, f.name));
  const res = await fetch(`${BASE}/api/finance/invoices/quick-add`, { method: "POST", body: form, credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Couldn't send it (${res.status})`);
  return body as QuickAddResult;
}

/** What to tell the person once it's sent. */
export function quickAddMessage(r: QuickAddResult): string {
  const parts: string[] = [];
  if (r.added) parts.push(`${r.added === 1 ? "It's" : `${r.added} are`} in the Finance Inbox for the accounts team.`);
  if (r.already) parts.push(`${r.already === 1 ? "One was" : `${r.already} were`} already there.`);
  if (r.refused.length) parts.push(`Not a photo or PDF, so not sent: ${r.refused.join(", ")}.`);
  return parts.join(" ") || "Nothing was sent.";
}

export function AddReceiptModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [done, setDone] = useState<QuickAddResult | null>(null);
  const [note, setNote] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const categoryBox = useRef<HTMLSelectElement>(null);
  const categories = useFinanceCategories();
  const ready = categoryId != null;
  const send = useMutation({ mutationFn: sendFiles, onSuccess: setDone });

  if (!open) return null;
  const reset = () => { setDone(null); setNote(""); setCategoryId(null); send.reset(); };
  const close = () => { if (send.isPending) return; reset(); onClose(); };
  const pick = (files: FileList | null) => {
    const arr = Array.from(files ?? []);
    if (arr.length && categoryId != null) send.mutate({ files: arr, note, categoryId });
  };
  // A photo button pressed before choosing what it is points at the dropdown.
  const choose = (input: HTMLInputElement | null) => {
    if (!ready) { categoryBox.current?.focus(); return; }
    input?.click();
  };

  return createPortal(
    <div className="fixed inset-0 z-[160] bg-black/50 flex items-center justify-center p-3 sm:p-6" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-receipt-title"
        className="bg-background rounded-3xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-border">
          <h2 id="add-receipt-title" className="flex-1 text-2xl font-bold leading-tight">Add receipt or invoice</h2>
          <button type="button" onClick={close} aria-label="Close" className="w-11 h-11 rounded-full hover:bg-secondary flex items-center justify-center flex-shrink-0">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
          <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
          {/* One at a time: a phone's picker makes ticking several too easy. */}
          <input ref={library} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />

          {send.isPending ? (
            <div className="min-h-[160px] flex flex-col items-center justify-center gap-3 text-lg font-semibold">
              <Loader2 className="w-10 h-10 animate-spin text-primary" /> Sending…
            </div>
          ) : done ? (
            <div className="rounded-2xl border-2 border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 p-5 space-y-2">
              <p className="text-xl font-bold flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="w-7 h-7" /> {done.added ? "Sent" : "Not sent"}
              </p>
              <p className="text-base">{quickAddMessage(done)}</p>
              {done.added > 0 && categoryId != null && (
                <p className="text-sm text-muted-foreground">
                  {categoryName(categories.data, categoryId)}{note.trim() ? ` · ${note.trim()}` : ""}
                </p>
              )}
            </div>
          ) : (
            <>
              <label className="block space-y-1.5">
                <span className="block text-lg font-bold">What is this item?</span>
                <CategorySelect value={categoryId} onChange={setCategoryId} size="lg" required selectRef={categoryBox} />
                {categories.isError && (
                  <span className="block text-sm text-destructive">{(categories.error as Error).message}</span>
                )}
              </label>
              <label className="block space-y-1.5">
                <span className="block text-sm font-semibold text-muted-foreground">Anything else the accounts team should know? (optional)</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  enterKeyHint="done"
                  placeholder="e.g. Milk from Tesco, paid on Lorna's card"
                  className="w-full h-12 px-4 rounded-2xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary"
                />
              </label>
              <button type="button" onClick={() => choose(camera.current)} aria-disabled={!ready}
                className={cn(
                  "w-full min-h-[88px] rounded-3xl bg-primary text-primary-foreground px-5 flex items-center gap-4 text-left shadow-lg active:scale-[0.99] transition-[transform,opacity]",
                  !ready && "opacity-40",
                )}>
                <Camera className="w-9 h-9 shrink-0" />
                <span>
                  <span className="block text-xl font-bold leading-tight">Take a photo</span>
                  <span className="block text-sm opacity-90">Lay it flat, all of it in the picture</span>
                </span>
              </button>
              <button type="button" onClick={() => choose(library.current)} aria-disabled={!ready}
                className={cn(
                  "w-full min-h-[88px] rounded-3xl border-2 border-border bg-card px-5 flex items-center gap-4 text-left shadow-sm active:scale-[0.99] transition-[transform,opacity]",
                  !ready && "opacity-40",
                )}>
                <ImagePlus className="w-9 h-9 shrink-0 text-primary" />
                <span>
                  <span className="block text-xl font-bold leading-tight">Choose from photos or files</span>
                  <span className="block text-sm text-muted-foreground">A photo you've taken, or a PDF</span>
                </span>
              </button>
              <p className="text-sm text-muted-foreground">It goes straight into the Finance Inbox for the accounts team to post.</p>
            </>
          )}
          {send.error && (
            <p role="alert" className="rounded-2xl border-2 border-red-400 bg-red-50 dark:bg-red-950/40 p-4 text-red-900 dark:text-red-200 font-semibold">
              {(send.error as Error).message}
            </p>
          )}
        </div>

        {done && (
          <div className="px-5 py-4 border-t border-border flex gap-3">
            <button type="button" onClick={reset}
              className="flex-1 min-h-[56px] rounded-xl border-2 border-border font-semibold text-lg">Add another</button>
            <button type="button" onClick={close}
              className="flex-1 min-h-[56px] rounded-xl bg-primary text-primary-foreground font-bold text-lg">Done</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
