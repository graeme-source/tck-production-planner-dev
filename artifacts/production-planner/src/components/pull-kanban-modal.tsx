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
//
// Or search instead (Graeme, 11 Nov 2026): type part of the name or the
// supplier and tap the item — the same confirm-then-pull as a scan.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, X, ScanLine, CheckCircle2, Search, Camera, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchKanbans } from "@/lib/kanban-search";
import { kanbanWaitingLabel } from "@/lib/kanban-waiting";
import { QrScanner } from "@/components/qr-scanner";
import { toast } from "@/hooks/use-toast";
import { parseKanbanQr } from "@/lib/kanban-qr";
import { KanbanPullConfirm, type KanbanPreview } from "@/components/kanban-pull-confirm";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type KanbanItem = {
  ingredientId: number;
  ingredientName: string | null;
  supplierName: string | null;
  supplierId: number | null;
  /** Pulled but put off with "Not today": the day it's back on the orders. */
  waitingUntil?: string | null;
};

export function PullKanbanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"scan" | "search">("scan");
  const [query, setQuery] = useState("");
  // Every item with a kanban — the list the Orders page's Add Kanbans uses.
  const kanbans = useQuery<KanbanItem[]>({
    queryKey: ["kanbans-ingredients-for-orders"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/kanbans/ingredients`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: open && mode === "search",
    staleTime: 60_000,
  });
  const matches = useMemo(() => searchKanbans(kanbans.data ?? [], query), [kanbans.data, query]);
  const [busy, setBusy] = useState(false);
  const [pulled, setPulled] = useState<string[]>([]);
  // Scanning only ever asks the question; the pull happens on confirmation.
  const [pending, setPending] = useState<(KanbanPreview & { target: { type: string; id: number } }) | null>(null);

  if (!open) return null;

  const close = () => { setPulled([]); setPending(null); setBusy(false); setQuery(""); onClose(); };

  const handleScan = async (data: string) => {
    if (pending) return; // a question is already on screen
    const parsed = parseKanbanQr(data);
    if (!parsed) {
      toast({ title: "Unrecognised QR code", description: "This doesn't look like a kanban card.", variant: "destructive" });
      return;
    }
    await preview(parsed);
  };

  // Scanned or picked from the search: ask first, pull on confirmation.
  const preview = async (parsed: { type: string; id: number }) => {
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
            <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-secondary/50" role="tablist" aria-label="How to find the kanban">
              {([["scan", "Scan the card", Camera], ["search", "Search", Search]] as const).map(([m, label, Icon]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "min-h-12 rounded-xl text-base font-semibold flex items-center justify-center gap-2 transition-colors",
                    mode === m ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="w-5 h-5" /> {label}
                </button>
              ))}
            </div>
            <p className="text-base text-muted-foreground">
              {mode === "scan" ? "Scan the QR on the card." : "Type part of the name or the supplier, then tap the item."}{" "}
              You'll be asked to confirm before anything is ordered.
            </p>
            {busy ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground text-lg">
                <Loader2 className="w-6 h-6 animate-spin mr-2" /> {mode === "scan" ? "Reading the card…" : "Checking…"}
              </div>
            ) : mode === "scan" ? (
              <div className="rounded-2xl overflow-hidden border-2 border-border">
                <QrScanner active={open && !pending && mode === "scan"} continuous onScan={handleScan} />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    type="search"
                    autoFocus
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="e.g. tape, sriracha, Macfarlane"
                    aria-label="Search kanbans"
                    className="w-full h-14 pl-12 pr-4 rounded-2xl border-2 border-border bg-background text-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                {kanbans.isLoading ? (
                  <p className="flex items-center gap-2 py-6 justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Loading kanbans…</p>
                ) : kanbans.isError ? (
                  <p className="py-4 text-center text-destructive">Couldn't load the kanbans — {(kanbans.error as Error).message}</p>
                ) : matches.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground">{query.trim() ? `No kanban matches "${query.trim()}".` : "No items have a kanban yet."}</p>
                ) : (
                  <ul className="max-h-[40vh] overflow-y-auto space-y-2 pr-1">
                    {matches.map(k => {
                      const waiting = kanbanWaitingLabel(k.waitingUntil);
                      return (
                        <li key={k.ingredientId}>
                          <button
                            type="button"
                            disabled={k.supplierId == null}
                            onClick={() => void preview({ type: "ingredient", id: k.ingredientId })}
                            className="w-full min-h-14 px-4 py-2.5 rounded-2xl border-2 border-border bg-background text-left hover:bg-secondary/40 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <span className="block text-base font-semibold">{k.ingredientName ?? "Unknown"}</span>
                            <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                              {k.supplierName ?? "No supplier set"}
                              {waiting && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300">
                                  <Clock className="w-3 h-3" /> Pulled · {waiting}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
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
