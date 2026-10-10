/**
 * "Back labels" from the wrapping station (Stage 2 first cut, Graeme
 * 2026-10-12): make the pack back labels for the recipe on the bench as a
 * print-ready PDF of its LIVE label — one label per page at exactly the
 * label size — then print it from this computer to the label printer
 * through its normal driver (Actual size / 100%, like Label LIVE today).
 *
 * The count starts at the item's net 2-packs (the "Net packs" on the From
 * Chiller card — 8-pack bags, wonkies and dog bins already come off it) and
 * can be changed with − / +. Nothing prints unless the live label still
 * matches the recipe. Closable (X / Close / tap outside), 92dvh, scrolls.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Minus, Plus, Printer, X } from "lucide-react";
import { formatLabelDate, initialPrintCount, MAX_PRINT_COUNT } from "@workspace/product-labels";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Preview {
  recipeId: number;
  recipeName: string;
  live: { versionNo: number; publishedAt: string; publishedByName: string | null } | null;
  canPrint: boolean;
  refusal: string | null;
  refusalText: string | null;
  dates: { printDate: string; productionDate: string; chilledUseBy?: string | null; frozenUseBy?: string | null; batchCode?: string };
  png: string | null;
  labelSize: { widthMm: number; heightMm: number } | null;
}

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function BackLabelsDialog({ recipeId, recipeName, planItemId, netPacks, onClose }: {
  recipeId: number; recipeName: string; planItemId: number; netPacks: number; onClose: () => void;
}) {
  const [count, setCount] = useState(() => initialPrintCount(netPacks));
  const [countText, setCountText] = useState(() => String(initialPrintCount(netPacks)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ count: number; url: string } | null>(null);

  const q = useQuery({
    queryKey: ["back-labels-preview", recipeId, planItemId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/product-label-print/${recipeId}/preview?planItemId=${planItemId}`, { credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Couldn't load (${res.status})`);
      return body as Preview;
    },
    staleTime: 0,
  });

  const setTo = (n: number) => {
    const v = Math.max(0, Math.min(MAX_PRINT_COUNT, Math.floor(n)));
    setCount(v);
    setCountText(String(v));
  };

  const make = async () => {
    if (!q.data?.canPrint || count < 1) return;
    setBusy(true); setError(null);
    // Open the tab now, inside the tap — iPad Safari blocks a window opened
    // after an await. The PDF is put into it when it arrives.
    const tab = window.open("", "_blank");
    try {
      const res = await fetch(`${BASE}/api/product-label-print/${recipeId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, planItemId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Couldn't make the labels (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `back-labels-${recipeName}.pdf`;
        a.click();
      }
      setMade({ count, url });
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Couldn't make the labels");
    } finally {
      setBusy(false);
    }
  };

  const p = q.data;
  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-3 md:p-6" onClick={onClose}>
      <div
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Back labels"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Printer className="w-6 h-6 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-xl leading-tight truncate">Back labels — {recipeName}</h2>
            <p className="text-sm text-muted-foreground">A print-ready PDF of the live label, one label per page.</p>
          </div>
          <button onClick={onClose} className="p-3 rounded-xl hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {q.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Checking the live label…</div>
          ) : q.isError || !p ? (
            <p className="text-destructive font-semibold">{(q.error as Error | null)?.message ?? "Couldn't load"}</p>
          ) : (
            <>
              {!p.canPrint ? (
                <div className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2">
                  <p className="font-bold flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-600" /> Can't print this one yet</p>
                  <p>{p.refusalText}</p>
                  <Link href={`/labels/${p.recipeId}`} className="inline-block font-semibold text-primary underline underline-offset-2">Open the {p.recipeName} label</Link>
                </div>
              ) : (
                <p className="text-base">
                  Prints the <Link href={`/labels/${p.recipeId}`} className="font-semibold text-primary underline underline-offset-2">live label</Link>, version {p.live?.versionNo}
                  {p.live?.publishedByName ? ` (checked by ${p.live.publishedByName})` : ""}.
                </p>
              )}

              {p.canPrint && (
                <>
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">How many labels</p>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => setTo(count - 1)} className="w-14 h-14 rounded-xl border-2 border-border flex items-center justify-center hover:bg-secondary" aria-label="One fewer"><Minus className="w-6 h-6" /></button>
                      <input
                        inputMode="numeric"
                        value={countText}
                        onChange={e => {
                          const t = e.target.value.replace(/[^\d]/g, "").slice(0, 3);
                          setCountText(t);
                          if (t !== "") setCount(Math.min(MAX_PRINT_COUNT, Number(t)));
                        }}
                        onBlur={() => setTo(Number(countText || 0))}
                        className="w-28 h-14 rounded-xl border-2 border-border bg-card text-center text-3xl font-bold tabular-nums"
                        aria-label="Number of labels"
                      />
                      <button type="button" onClick={() => setTo(count + 1)} className="w-14 h-14 rounded-xl border-2 border-border flex items-center justify-center hover:bg-secondary" aria-label="One more"><Plus className="w-6 h-6" /></button>
                      {count !== initialPrintCount(netPacks) && (
                        <button type="button" onClick={() => setTo(netPacks)} className="text-sm font-semibold text-primary underline">Back to {initialPrintCount(netPacks)}</button>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">Starts at the {initialPrintCount(netPacks)} net 2-packs from the chiller (8-pack bags, wonkies and dog bins already taken off).</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-base">
                    <Fact label="Printed" value={day(p.dates.printDate)} />
                    <Fact label="Made (production day)" value={day(p.dates.productionDate)} />
                    {p.dates.chilledUseBy && <Fact label="Chilled use by" value={formatLabelDate(p.dates.chilledUseBy)} />}
                    {p.dates.frozenUseBy && <Fact label="Frozen use by" value={formatLabelDate(p.dates.frozenUseBy)} />}
                    {p.dates.batchCode && <Fact label="Batch number" value={p.dates.batchCode} />}
                    {p.labelSize && <Fact label="Label" value={`${p.labelSize.widthMm} × ${p.labelSize.heightMm} mm`} />}
                  </div>

                  {p.png && (
                    <img src={p.png} alt="The label that will print" className="w-full rounded-lg ring-1 ring-border bg-white" style={{ imageRendering: "pixelated" }} />
                  )}
                </>
              )}

              {made && (
                <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 p-4 space-y-1">
                  <p className="font-bold">{made.count} labels made — the PDF opened in a new tab.</p>
                  <p className="text-sm">Print it to the label printer at <b>Actual size / 100%</b> (no “fit to page”). <a href={made.url} target="_blank" rel="noreferrer" className="underline font-semibold">Open it again</a></p>
                </div>
              )}
              {error && <p className="text-destructive font-semibold">{error}</p>}
            </>
          )}
        </div>

        <div className="border-t border-border p-4 flex flex-wrap gap-3 justify-end">
          <button onClick={onClose} className="h-12 px-5 rounded-xl border-2 border-border font-semibold hover:bg-secondary">Close</button>
          <button
            onClick={make}
            disabled={!p?.canPrint || count < 1 || busy}
            className={cn("h-12 px-6 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-40")}
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />} Make {count} label{count === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-bold tabular-nums">{value}</p>
    </div>
  );
}
