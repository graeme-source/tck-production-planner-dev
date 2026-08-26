// "Pull kanban" — scan the QR on the back of a kanban card and it goes on
// today's order (Graeme, 2026-08-28).
//
// The same scan that has always lived on the Orders page, moved to where
// people actually stand when a bin runs low. One tap from the dock, camera
// opens, scan, done — and it keeps scanning so a run round the dry store is
// one continuous sweep rather than re-opening the camera each time.
//
// The parser accepts every shape a kanban QR has ever been printed in:
//   {"type":"ingredient","id":12}   — what the cards carry today
//   https://…/scan?type=ingredient&id=12  — the deep-link form (see /scan)
//   12                              — a bare id, oldest cards
// so a reprint programme can happen gradually without a flag day.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, X, ScanLine, CheckCircle2 } from "lucide-react";
import { QrScanner } from "@/components/qr-scanner";
import { toast } from "@/hooks/use-toast";
import { parseKanbanQr } from "@/lib/kanban-qr";
import { KanbanPullConfirm, type KanbanPreview } from "@/components/kanban-pull-confirm";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function PullKanbanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [pulled, setPulled] = useState<string[]>([]);
  // Scanning only ever asks the question; the pull happens on confirmation.
  const [pending, setPending] = useState<(KanbanPreview & { target: { type: string; id: number } }) | null>(null);

  if (!open) return null;

  const close = () => { setPulled([]); setPending(null); setBusy(false); onClose(); };

  const handleScan = async (data: string) => {
    if (pending) return; // a question is already on screen
    const parsed = parseKanbanQr(data);
    if (!parsed) {
      toast({ title: "Unrecognised QR code", description: "This doesn't look like a kanban card.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/kanbans/scan/preview`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Couldn't read that card", description: body.error ?? "Scan failed.", variant: "destructive" });
        return;
      }
      setPending({ ...body, target: parsed });
    } finally {
      setBusy(false);
    }
  };

  const confirmPull = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/kanbans/scan`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending.target),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Couldn't pull it", description: body.error ?? "Scan failed.", variant: "destructive" });
        return;
      }
      const name = body.ingredientName ?? pending.ingredientName;
      setPulled(prev => (prev.includes(name) ? prev : [...prev, name]));
      queryClient.invalidateQueries({ queryKey: ["kanbans"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast({ title: `${name} pulled`, description: "It's on today's order." });
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={close}>
      <div
        className="bg-background w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Pull a kanban</h2>
          <button onClick={close} className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {pending ? (
          <KanbanPullConfirm
            preview={pending}
            busy={busy}
            onConfirm={confirmPull}
            onCancel={() => setPending(null)}
          />
        ) : (
          <>
            <p className="text-base text-muted-foreground">
              Scan the QR on the card. You'll be asked to confirm before anything is ordered.
            </p>
            {busy ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground text-lg">
                <Loader2 className="w-6 h-6 animate-spin mr-2" /> Reading the card…
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden border-2 border-border">
                <QrScanner active={open && !pending} continuous onScan={handleScan} />
              </div>
            )}
          </>
        )}

        {pulled.length > 0 && (
          <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-4">
            <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400 mb-2">
              On today's order ({pulled.length})
            </p>
            <ul className="space-y-1">
              {pulled.map(name => (
                <li key={name} className="flex items-center gap-2 text-base font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" /> {name}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={close}
          className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 active:scale-[0.99] transition-all"
        >
          <ScanLine className="w-6 h-6" /> Done
        </button>
      </div>
    </div>
  );
}
