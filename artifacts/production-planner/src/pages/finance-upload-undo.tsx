import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { jsonFetch, money, ukDate } from "@/pages/finance-invoice-drop";
import { AlertTriangle, Loader2, X } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api/finance/upload-undo`;

// Undo a statement upload, seeing exactly what will happen first (Graeme, 4 Nov
// 2026). A quiet link on the Card statement panel (6 Nov), so nobody takes it
// for undoing an invoice. Founder only: anyone else gets no link.

type Upload = { id: number; fileName: string | null; rowCount: number; newCount: number; createdAt: string; linesLeft: number };
type Preview = {
  upload: { id: number; fileName: string | null; createdAt: string };
  removing: number; removingValue: string; postedAmongThem: number;
  keeping: Array<{ id: number; supplier: string; date: string; amount: string; reason: string }>;
  automaticMatches: number; otherAutomaticMatches: number; libraryQueued: number; quickBooksImportOn: boolean;
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function UndoUploadLink() {
  const [open, setOpen] = useState(false);
  const uploads = useQuery<{ uploads: Upload[] }>({ queryKey: ["/api/finance/upload-undo"], queryFn: () => jsonFetch(API), retry: false });
  if (!uploads.data) return null;
  return (
    <>
      <button type="button" className="py-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setOpen(true)}>
        Undo a previous upload
      </button>
      {open && <UndoDialog uploads={uploads.data.uploads} onClose={() => setOpen(false)} />}
    </>
  );
}

function UndoDialog({ uploads, onClose }: { uploads: Upload[]; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<number | null>(null);
  const [sure, setSure] = useState(false);
  const [alsoOthers, setAlsoOthers] = useState(false);
  const preview = useQuery<Preview>({
    queryKey: ["/api/finance/upload-undo", chosen, "preview"],
    queryFn: () => jsonFetch(`${API}/${chosen}/preview`),
    enabled: chosen != null,
    staleTime: 0,
  });
  const undo = useMutation({
    mutationFn: () => jsonFetch(`${API}/${chosen}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true, alsoOtherMatches: alsoOthers }) }) as Promise<{ removed: number; kept: number; automaticMatches: number; libraryQueued: number }>,
    onSuccess: (r) => {
      toast({ title: `Removed ${r.removed} transactions`, description: `${r.automaticMatches} automatic matches taken off, ${r.libraryQueued} invoices out of the Inbox, ${r.kept} transactions kept.` });
      void queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/finance/upload-undo"] });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Couldn't undo it", description: e.message, variant: "destructive" }),
  });
  const p = preview.data;

  // On the page itself, fixed would be relative to the page's panel, not the screen.
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-card rounded-2xl border w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-label="Undo an upload" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b">
          <h2 className="flex-1 text-xl font-bold">Undo an upload</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="space-y-2">
            {uploads.map((u) => (
              <button key={u.id} onClick={() => { setChosen(u.id); setSure(false); }}
                className={`w-full text-left rounded-xl border-2 p-3 ${chosen === u.id ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/40"}`}>
                <div className="font-semibold break-words">{u.fileName ?? "Statement"}</div>
                <div className="text-sm text-muted-foreground">{when(u.createdAt)} · {u.newCount} new · {u.linesLeft} still here</div>
              </button>
            ))}
            {uploads.length === 0 && <p className="text-sm text-muted-foreground">No uploads.</p>}
          </div>

          {preview.isFetching && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Working out what this would do…</p>}
          {preview.isError && <p className="text-sm text-destructive">{(preview.error as Error).message}</p>}

          {p && !preview.isFetching && (
            <div className="space-y-3">
              <ul className="rounded-xl border p-4 space-y-1 text-base">
                <li><b>{p.removing}</b> transactions removed, {money(p.removingValue)} in total{p.postedAmongThem ? `, ${p.postedAmongThem} of them posted in QuickBooks` : ""}</li>
                <li><b>{p.automaticMatches + (alsoOthers ? p.otherAutomaticMatches : 0)}</b> automatic invoice matches taken off</li>
                <li><b>{p.libraryQueued}</b> library invoices taken out of the Inbox</li>
                <li><b>{p.keeping.length}</b> transactions kept because someone worked on them</li>
              </ul>
              {p.quickBooksImportOn && (
                <div role="alert" className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
                  <span className="font-medium">QuickBooks auto-import is on, so posted card purchases will come back as new transactions at the next hourly sync.</span>
                </div>
              )}
              {p.keeping.length > 0 && (
                <details className="rounded-xl border p-3">
                  <summary className="font-semibold cursor-pointer">Transactions being kept</summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {p.keeping.map((k) => <li key={k.id} className="break-words">{k.supplier}, {money(k.amount)} on {ukDate(k.date)}: {k.reason}</li>)}
                  </ul>
                </details>
              )}
              {p.otherAutomaticMatches > 0 && (
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox checked={alsoOthers} onCheckedChange={(v) => setAlsoOthers(v === true)} className="mt-1" />
                  <span>Also take off the {p.otherAutomaticMatches} automatic matches on transactions that weren't in this upload. Leave this unticked to keep them.</span>
                </label>
              )}
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox checked={sure} onCheckedChange={(v) => setSure(v === true)} className="mt-1" />
                <span>I've checked this. The transactions above will be removed.</span>
              </label>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!p || !sure || undo.isPending || preview.isFetching} onClick={() => undo.mutate()}>
            {undo.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Undo this upload
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
