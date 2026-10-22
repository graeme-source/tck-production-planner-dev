/**
 * "Print front labels" (#331, Kerri-Leigh Dovale; approved by Graeme
 * 2026-10-22): the 102 × 25 mm front name label for a recipe — its label name
 * (or name) in big bold type on one line, with an optional short second line —
 * as a print-ready PDF, one label per page, printed like the back labels
 * (from this computer, label printer, Actual size / 100%). The name comes from
 * the recipe, so a new test flavour has a front label as soon as its recipe
 * exists. Closable (X / Close / tap outside), 92dvh, scrolls inside.
 */
import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Loader2, Minus, Plus, Printer, X } from "lucide-react";
import { FRONT_SECOND_LINE_MAX, initialPrintCount, MAX_PRINT_COUNT } from "@workspace/product-labels";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FrontPreview {
  recipeId: number;
  recipeName: string;
  name: string;
  canPrint: boolean;
  png: string | null;
  labelSize: { widthMm: number; heightMm: number };
}

/** The front label on the recipe's label page, under the back-label proofs. */
export function FrontLabelPreview({ recipeId, onPrint }: { recipeId: number; onPrint: () => void }) {
  const q = useQuery({
    queryKey: ["front-label-preview", recipeId, ""],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/product-front-label/${recipeId}/preview`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Couldn't load (${res.status})`);
      return body as FrontPreview;
    },
  });
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">Front label — 102 × 25 mm</h2>
        <button type="button" onClick={onPrint}
          className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-border bg-card font-semibold hover:bg-secondary">
          <Printer className="w-5 h-5" /> Print front labels
        </button>
      </div>
      {q.isLoading ? (
        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Drawing the front label…</p>
      ) : q.isError ? (
        <p className="text-destructive font-semibold">Couldn't draw the front label — {(q.error as Error).message}</p>
      ) : q.data?.png ? (
        <img src={q.data.png} alt={`Front label: ${q.data.name}`} className="w-full max-w-2xl rounded-lg ring-1 ring-border bg-white" />
      ) : (
        <p className="text-muted-foreground">No name to print.</p>
      )}
    </section>
  );
}

export function FrontLabelsDialog({ recipeId, recipeName, netPacks, onClose }: {
  recipeId: number; recipeName: string;
  /** From the wrapping station: start the count at the net 2-packs. */
  netPacks?: number;
  onClose: () => void;
}) {
  const startCount = netPacks != null ? initialPrintCount(netPacks) : 1;
  const [count, setCount] = useState(startCount);
  const [countText, setCountText] = useState(() => String(startCount));
  const [second, setSecond] = useState("");
  // The preview follows the second line after a short pause in typing.
  const [secondForPreview, setSecondForPreview] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSecondForPreview(second.trim()), 350);
    return () => clearTimeout(t);
  }, [second]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ count: number; url: string } | null>(null);

  const q = useQuery({
    queryKey: ["front-label-preview", recipeId, secondForPreview],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (secondForPreview) params.set("second", secondForPreview);
      const res = await fetch(`${BASE}/api/product-front-label/${recipeId}/preview?${params}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Couldn't load (${res.status})`);
      return body as FrontPreview;
    },
    placeholderData: keepPreviousData,
  });

  const setTo = (n: number) => {
    const v = Math.max(0, Math.min(MAX_PRINT_COUNT, Math.floor(n)));
    setCount(v);
    setCountText(String(v));
  };

  const make = async () => {
    if (!q.data?.canPrint || count < 1) return;
    setBusy(true); setError(null);
    // Open the tab inside the tap — iPad Safari blocks one opened after an await.
    const tab = window.open("", "_blank");
    try {
      const res = await fetch(`${BASE}/api/product-front-label/${recipeId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, secondLine: second.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Couldn't make the labels (${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `front-labels-${recipeName}.pdf`;
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
        role="dialog" aria-modal="true" aria-label="Front labels"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Printer className="w-6 h-6 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-xl leading-tight break-words">Front labels — {recipeName}</h2>
            <p className="text-sm text-muted-foreground">The name label for the front of the pack, 102 × 25 mm, one label per page.</p>
          </div>
          <button onClick={onClose} className="p-3 rounded-xl hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {q.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Drawing the label…</div>
          ) : q.isError || !p ? (
            <p className="text-destructive font-semibold">{(q.error as Error | null)?.message ?? "Couldn't load"}</p>
          ) : (
            <>
              {p.png ? (
                <div className="space-y-1">
                  <img src={p.png} alt={`Front label: ${p.name}`} className="w-full rounded-lg ring-1 ring-border bg-white" />
                  <p className="text-sm text-muted-foreground">
                    Prints “{p.name}” — the recipe's label name (change it in the label settings below the proofs).
                    {q.isFetching && <Loader2 className="inline w-4 h-4 ml-2 animate-spin" />}
                  </p>
                </div>
              ) : (
                <p className="text-destructive font-semibold">This recipe has no name to print.</p>
              )}

              <label className="block space-y-1">
                <span className="text-sm font-semibold">Second line (optional)</span>
                <input
                  value={second}
                  onChange={e => setSecond(e.target.value.slice(0, FRONT_SECOND_LINE_MAX))}
                  placeholder="e.g. Test flavour"
                  className="w-full h-12 px-3 rounded-xl border-2 border-border bg-background text-base"
                />
                <span className="text-xs text-muted-foreground">Short, under the name — up to {FRONT_SECOND_LINE_MAX} letters. Only for this print; not saved.</span>
              </label>

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
                </div>
              </div>

              {made && (
                <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 p-4 space-y-1">
                  <p className="font-bold">{made.count} front label{made.count === 1 ? "" : "s"} made — the PDF opened in a new tab.</p>
                  <p className="text-sm">Print it to the label printer loaded with the 102 × 25 mm front labels, at <b>Actual size / 100%</b> (no “fit to page”). <a href={made.url} target="_blank" rel="noreferrer" className="underline font-semibold">Open it again</a></p>
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
            className="h-12 px-6 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />} Make {count} front label{count === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
